const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("customizetoken", function () {
    let owner, admin, newAdmin, user, token, mockPriceFeed;

    const BNB_PRICE = 600n * 10n**8n; // $600 with 8 decimals
    const TOKEN_PRICE_USD = 100000000000000000n; // 0.1 USD with 18 decimals

    beforeEach(async function () {
        [owner, admin, newAdmin, user] = await ethers.getSigners();

        // Deploy MockPriceFeed
        const MockPriceFeed = await ethers.getContractFactory("MockPriceFeed");
        mockPriceFeed = await MockPriceFeed.deploy(BNB_PRICE);
        await mockPriceFeed.waitForDeployment();

        // Deploy customizetoken
        const Token = await ethers.getContractFactory("customizetoken");
        token = await Token.deploy(owner.address, admin.address, ethers.parseUnits("10000000000", 18));
        await token.waitForDeployment();

        // Set the price feed on the token contract
        await token.connect(admin).setBnbPriceFeed(await mockPriceFeed.getAddress());
    });

    describe("Deployment", function () {
        it("Should set the right owner, admin, and total supply", async function () {
            const tokenAddress = await token.getAddress();
            const contractBalance = await token.balanceOf(tokenAddress);
            expect(await token.totalSupply()).to.equal(contractBalance);
            expect(await token.owner()).to.equal(owner.address);
            expect(await token.admin()).to.equal(admin.address);
        });
    });

    describe("Admin functions", function () {
        it("Should allow admin to change admin", async function () {
            await token.connect(admin).changeAdmin(newAdmin.address);
            expect(await token.admin()).to.equal(newAdmin.address);
        });

        it("Should prevent non-admin from changing admin", async function () {
            await expect(token.connect(user).changeAdmin(newAdmin.address)).to.be.revertedWith("Only admin can perform this task");
        });

        it("Should allow admin to set BNB price feed", async function () {
            const newMockPriceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(700n * 10n**8n);
            await newMockPriceFeed.waitForDeployment();
            await token.connect(admin).setBnbPriceFeed(await newMockPriceFeed.getAddress());
            expect(await token.priceFeed()).to.equal(await newMockPriceFeed.getAddress());
        });
    });

    describe("buyToken with BNB", function () {
        it("Should allow a user to buy tokens with BNB", async function () {
            const amountToBuy = ethers.parseUnits("1000", 18); // 1000 tokens

            // Calculate expected cost in BNB
            const costUsd = (amountToBuy * TOKEN_PRICE_USD) / (10n**18n);
            const expectedBnbCost = (costUsd * 10n**8n) / BNB_PRICE;

            await token.connect(user).buyToken(amountToBuy, ethers.ZeroAddress, { value: expectedBnbCost });

            const vestingInfo = await token.vesting(user.address, 0);
            expect(vestingInfo.totalAmount).to.equal(amountToBuy);
            expect(vestingInfo.startTime).to.be.gt(0);
        });

        it("Should revert if insufficient BNB is sent", async function () {
            const amountToBuy = ethers.parseUnits("1000", 18);
            const costUsd = (amountToBuy * TOKEN_PRICE_USD) / (10n ** 18n);
            const expectedBnbCost = (costUsd * 10n ** 8n) / BNB_PRICE;
            
            await expect(
                token.connect(user).buyToken(amountToBuy, ethers.ZeroAddress, { value: expectedBnbCost - 1n })
            ).to.be.revertedWith("Insufficient BNB sent");
        });

        it("Should allow user to have multiple vesting orders", async function () {
            const amountToBuy = ethers.parseUnits("1000", 18);
            const costUsd = (amountToBuy * TOKEN_PRICE_USD) / (10n ** 18n);
            const expectedBnbCost = (costUsd * 10n ** 8n) / BNB_PRICE;

            // First purchase
            await token.connect(user).buyToken(amountToBuy, ethers.ZeroAddress, { value: expectedBnbCost });
            const vestingInfo1 = await token.vesting(user.address, 0);
            expect(vestingInfo1.totalAmount).to.equal(amountToBuy);

            // Second purchase
            await token.connect(user).buyToken(amountToBuy, ethers.ZeroAddress, { value: expectedBnbCost });
            const vestingInfo2 = await token.vesting(user.address, 1);
            expect(vestingInfo2.totalAmount).to.equal(amountToBuy);

            expect(await token.userOrders(user.address)).to.equal(2);
        });
    });

    describe("Vesting and Claiming", function () {
        beforeEach(async function() {
            const amountToBuy = ethers.parseUnits("1000", 18);
            const costUsd = (amountToBuy * TOKEN_PRICE_USD) / (10n ** 18n);
            const expectedBnbCost = (costUsd * 10n ** 8n) / BNB_PRICE;
            await token.connect(user).buyToken(amountToBuy, ethers.ZeroAddress, { value: expectedBnbCost });
        });

        it("Should not allow claiming before 1 year", async function () {
            await expect(token.connect(user).claimTokens(0)).to.be.revertedWith("Tokens are still locked");
        });

        it("Should allow claiming 10% after 1 year and 1 month", async function () {
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            await token.connect(user).claimTokens(0);
            
            const vestingInfo = await token.vesting(user.address, 0);
            const expectedClaim = ethers.parseUnits("100", 18); // 10% of 1000
            expect(vestingInfo.claimedAmount).to.equal(expectedClaim);

            const userBalance = await token.balanceOf(user.address);
            expect(userBalance).to.equal(expectedClaim);
        });

        it("Should allow claiming 100% after 1 year and 10 months", async function () {
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 10 * 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            await token.connect(user).claimTokens(0);
            
            const vestingInfo = await token.vesting(user.address, 0);
            const expectedClaim = ethers.parseUnits("1000", 18); // 100% of 1000
            expect(vestingInfo.claimedAmount).to.equal(expectedClaim);
        });

        it("Should allow partial claims", async function () {
            // Claim 10%
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");
            await token.connect(user).claimTokens(0);
            
            let vestingInfo = await token.vesting(user.address, 0);
            expect(vestingInfo.claimedAmount).to.equal(ethers.parseUnits("100", 18));

            // Claim another 10% (total 20%)
            await network.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");
            await token.connect(user).claimTokens(0);

            vestingInfo = await token.vesting(user.address, 0);
            expect(vestingInfo.claimedAmount).to.equal(ethers.parseUnits("200", 18));
        });
    });

    describe("sellToken", function () {
        const buyAmount = ethers.parseUnits("1000", 18);

        beforeEach(async function() {
            // Buy tokens
            const costUsd = (buyAmount * TOKEN_PRICE_USD) / (10n ** 18n);
            const expectedBnbCost = (costUsd * 10n ** 8n) / BNB_PRICE;
            await token.connect(user).buyToken(buyAmount, ethers.ZeroAddress, { value: expectedBnbCost });

            // Fast forward time to unlock all tokens
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 10 * 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            // Claim all tokens
            await token.connect(user).claimTokens(0);
            
            // Send some BNB to the contract for liquidity
            await owner.sendTransaction({ to: await token.getAddress(), value: ethers.parseEther("10") });
        });
        
        
        it("Should allow user to sell claimed tokens for BNB", async function () {
    const userBalanceBefore = await ethers.provider.getBalance(user.address);

    const sellAmount = ethers.parseUnits("500", 18);

    const tx = await token.connect(user).sellToken(ethers.ZeroAddress, sellAmount, 0);
    const receipt = await tx.wait();

    const gasUsed = receipt.gasUsed;
    let gasPrice;

    // Fallback to tx.gasPrice if effectiveGasPrice is undefined
    if (receipt.effectiveGasPrice !== undefined) {
        gasPrice = receipt.effectiveGasPrice;
    } else {
        const txDetails = await ethers.provider.getTransaction(tx.hash);
        gasPrice = txDetails.gasPrice;
    }

    const gasCost = gasUsed * gasPrice;

    const userBalanceAfter = await ethers.provider.getBalance(user.address);

    const payoutAmount = (((sellAmount * TOKEN_PRICE_USD) / (10n ** 18n)) * 10n ** 8n) / BNB_PRICE;

    const expectedBalance = userBalanceBefore - gasCost + payoutAmount;

    expect(userBalanceAfter).to.equal(expectedBalance);

    const userTokenBalance = await token.balanceOf(user.address);
    const expectedTokenBalance = buyAmount - sellAmount;

    expect(userTokenBalance).to.equal(expectedTokenBalance);
});




        it("Should revert if trying to sell more than claimed tokens", async function() {
            const sellAmount = ethers.parseUnits("1001", 18);
            await expect(token.connect(user).sellToken(ethers.ZeroAddress, sellAmount, 0)).to.be.revertedWith("Not enough unlocked tokens to sell");
        });

        it("Should allow user to sell for other ERC20 tokens", async function() {
            // Deploy mock USDT with 18 decimals to match the contract's calculation
            const MockUSDT = await ethers.getContractFactory("MockERC20");
            const usdt = await MockUSDT.deploy("Tether", "USDT", ethers.parseUnits("1000000", 18));
            await usdt.waitForDeployment();

            // Deploy mock USDT price feed ($1)
            const usdtPriceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(1n * 10n**8n);
            await usdtPriceFeed.waitForDeployment();
            
            // Register token and price feed
            await token.connect(admin).setPrizeFeed(await usdt.getAddress(), await usdtPriceFeed.getAddress());
            
            // Provide liquidity with 18-decimal USDT
            await usdt.transfer(await token.getAddress(), ethers.parseUnits("500000", 18));

            const sellAmount = ethers.parseUnits("500", 18);
            await token.connect(user).sellToken(await usdt.getAddress(), sellAmount, 0);

            const userUsdtBalance = await usdt.balanceOf(user.address);
            
            // Calculate expected payout in USDT (18 decimals)
            const tokenValueInUsd = (sellAmount * TOKEN_PRICE_USD) / (10n ** 18n);
            const usdtPrice = 1n * 10n**8n;
            const expectedUsdt = (tokenValueInUsd * (10n**8n)) / usdtPrice;
            
            expect(userUsdtBalance).to.equal(expectedUsdt);
        });
    });
}); 