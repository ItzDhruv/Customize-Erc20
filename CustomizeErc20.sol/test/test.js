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

        it("Should start with order number 1", async function () {
            expect(await token.currentOrderNumber()).to.equal(1);
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
            const bnbToSend = ethers.parseEther("1"); // 1 BNB

            // Calculate expected token amount
            const usdValue = (bnbToSend * BNB_PRICE) / (10n**8n);
            const expectedTokens = (usdValue * (10n**18n)) / TOKEN_PRICE_USD;

            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });

            // Check order details
            const orderDetails = await token.getOrderDetails(1);
            expect(orderDetails.totalAmount).to.equal(expectedTokens);
            expect(orderDetails.buyer).to.equal(user.address);
            expect(orderDetails.paymentToken).to.equal(ethers.ZeroAddress);
            expect(orderDetails.startTime).to.be.gt(0);

            // Check user's order numbers
            const userOrders = await token.getUserOrderNumbers(user.address);
            expect(userOrders.length).to.equal(1);
            expect(userOrders[0]).to.equal(1);

            // Check current order number incremented
            expect(await token.currentOrderNumber()).to.equal(2);
        });

        it("Should revert if no BNB is sent", async function () {
            await expect(
                token.connect(user).buyToken(ethers.ZeroAddress, { value: 0 })
            ).to.be.revertedWith("Must send BNB");
        });

        it("Should allow user to have multiple vesting orders", async function () {
            const bnbToSend = ethers.parseEther("1");

            // First purchase
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });
            
            // Second purchase
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });

            // Check user has 2 orders
            const userOrders = await token.getUserOrderNumbers(user.address);
            expect(userOrders.length).to.equal(2);
            expect(userOrders[0]).to.equal(1);
            expect(userOrders[1]).to.equal(2);

            // Check current order number
            expect(await token.currentOrderNumber()).to.equal(3);

            // Verify both orders exist
            const order1 = await token.getOrderDetails(1);
            const order2 = await token.getOrderDetails(2);
            expect(order1.buyer).to.equal(user.address);
            expect(order2.buyer).to.equal(user.address);
        });

        it("Should calculate tokens correctly based on price tiers", async function () {
            // Send large amount to test price tier calculation
            const largeBnbAmount = ethers.parseEther("100"); // 100 BNB
            
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: largeBnbAmount });

            const orderDetails = await token.getOrderDetails(1);
            expect(orderDetails.totalAmount).to.be.gt(0);
            
            // Check that soldTokens was updated
            const soldTokens = await token.soldTokens();
            expect(soldTokens).to.equal(orderDetails.totalAmount);
        });
    });

    describe("buyToken with ERC20", function () {
        let mockToken;

        beforeEach(async function () {
            // Deploy mock ERC20 token
            const MockERC20 = await ethers.getContractFactory("MockERC20");
            mockToken = await MockERC20.deploy("MockToken", "MT", ethers.parseUnits("1000000", 18));
            await mockToken.waitForDeployment();

            // Deploy price feed for mock token ($1)
            const mockTokenPriceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(1n * 10n**8n);
            await mockTokenPriceFeed.waitForDeployment();

            // Register token and price feed
            await token.connect(admin).setPrizeFeed(await mockToken.getAddress(), await mockTokenPriceFeed.getAddress());

            // Transfer some tokens to user and approve
            await mockToken.transfer(user.address, ethers.parseUnits("1000", 18));
        });

        it("Should allow user to buy tokens with ERC20", async function () {
            const approveAmount = ethers.parseUnits("100", 18); // 100 mock tokens
            
            await mockToken.connect(user).approve(await token.getAddress(), approveAmount);
            await token.connect(user).buyToken(await mockToken.getAddress());

            // Check order details
            const orderDetails = await token.getOrderDetails(1);
            expect(orderDetails.buyer).to.equal(user.address);
            expect(orderDetails.paymentToken).to.equal(await mockToken.getAddress());
            expect(orderDetails.totalAmount).to.be.gt(0);

            // Check tokens were transferred
            const userBalance = await mockToken.balanceOf(user.address);
            expect(userBalance).to.equal(ethers.parseUnits("900", 18)); // 1000 - 100
        });

        it("Should revert if no allowance given", async function () {
            await expect(
                token.connect(user).buyToken(await mockToken.getAddress())
            ).to.be.revertedWith("No allowance given");
        });

        it("Should revert if token not registered", async function () {
            const unregisteredToken = await (await ethers.getContractFactory("MockERC20")).deploy("Unregistered", "UN", ethers.parseUnits("1000", 18));
            await unregisteredToken.waitForDeployment();

            await expect(
                token.connect(user).buyToken(await unregisteredToken.getAddress())
            ).to.be.revertedWith("Token not accepted");
        });
    });

    describe("Vesting and Claiming", function () {
        let orderNumber;

        beforeEach(async function() {
            const bnbToSend = ethers.parseEther("1");
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });
            orderNumber = 1;
        });

        it("Should not allow claiming before 1 year", async function () {
            await expect(token.connect(user).claimTokens(orderNumber)).to.be.revertedWith("Tokens are still locked");
        });

        it("Should prevent claiming someone else's order", async function () {
            await expect(token.connect(admin).claimTokens(orderNumber)).to.be.revertedWith("Not your order");
        });

        it("Should allow claiming 10% after 1 year and 1 month", async function () {
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            await token.connect(user).claimTokens(orderNumber);
            
            const orderDetails = await token.getOrderDetails(orderNumber);
            const expectedClaim = orderDetails.totalAmount / 10n; // 10% of total
            expect(orderDetails.claimedAmount).to.equal(expectedClaim);

            const userBalance = await token.balanceOf(user.address);
            expect(userBalance).to.equal(expectedClaim);
        });

        it("Should allow claiming 100% after 1 year and 10 months", async function () {
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 10 * 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            await token.connect(user).claimTokens(orderNumber);
            
            const orderDetails = await token.getOrderDetails(orderNumber);
            expect(orderDetails.claimedAmount).to.equal(orderDetails.totalAmount);
        });

        it("Should allow partial claims", async function () {
            // Claim 10%
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");
            await token.connect(user).claimTokens(orderNumber);
            
            let orderDetails = await token.getOrderDetails(orderNumber);
            const firstClaim = orderDetails.claimedAmount;
            expect(firstClaim).to.equal(orderDetails.totalAmount / 10n);

            // Claim another 10% (total 20%)
            await network.provider.send("evm_increaseTime", [30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");
            await token.connect(user).claimTokens(orderNumber);

            orderDetails = await token.getOrderDetails(orderNumber);
            expect(orderDetails.claimedAmount).to.equal(orderDetails.totalAmount * 2n / 10n);
        });

        it("Should calculate claimable amount correctly", async function () {
            // Before vesting period
            let claimable = await token.calculateClaimable(orderNumber);
            expect(claimable).to.equal(0);

            // After 1 year and 3 months (30% should be claimable)
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 3 * 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            claimable = await token.calculateClaimable(orderNumber);
            const orderDetails = await token.getOrderDetails(orderNumber);
            const expectedClaimable = orderDetails.totalAmount * 3n / 10n;
            expect(claimable).to.equal(expectedClaimable);
        });
    });

    describe("Admin timeline changes", function () {
        let orderNumber;

        beforeEach(async function() {
            const bnbToSend = ethers.parseEther("1");
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });
            orderNumber = 1;
        });

        it("Should allow admin to change vesting timeline", async function () {
            const newStartTime = Math.floor(Date.now() / 1000) + 86400; // 1 day from now
            
            await token.connect(admin).changeTimeline(orderNumber, newStartTime);
            
            const orderDetails = await token.getOrderDetails(orderNumber);
            expect(orderDetails.startTime).to.equal(newStartTime);
        });

        it("Should prevent non-admin from changing timeline", async function () {
            const newStartTime = Math.floor(Date.now() / 1000) + 86400;
            
            await expect(
                token.connect(user).changeTimeline(orderNumber, newStartTime)
            ).to.be.revertedWith("Only admin can perform this task");
        });

        it("Should revert if order doesn't exist", async function () {
            const newStartTime = Math.floor(Date.now() / 1000) + 86400;
            
            await expect(
                token.connect(admin).changeTimeline(999, newStartTime)
            ).to.be.revertedWith("Order does not exist");
        });
    });

    describe("sellToken", function () {
        let orderNumber;

        beforeEach(async function() {
            // Buy tokens
            const bnbToSend = ethers.parseEther("1");
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: bnbToSend });
            orderNumber = 1;

            // Fast forward time to unlock all tokens
            await network.provider.send("evm_increaseTime", [365 * 24 * 60 * 60 + 10 * 30 * 24 * 60 * 60]);
            await network.provider.send("evm_mine");

            // Claim all tokens
            await token.connect(user).claimTokens(orderNumber);
            
            // Send some BNB to the contract for liquidity
            await owner.sendTransaction({ to: await token.getAddress(), value: ethers.parseEther("10") });
        });

        it("Should allow user to sell claimed tokens for BNB", async function () {
            const userBalanceBefore = await ethers.provider.getBalance(user.address);
            const orderDetails = await token.getOrderDetails(orderNumber);
            const sellAmount = orderDetails.claimedAmount / 2n; // Sell 50%

            const tx = await token.connect(user).sellToken(ethers.ZeroAddress, sellAmount, orderNumber);
            const receipt = await tx.wait();

            const gasUsed = receipt.gasUsed;
            let gasPrice;

            if (receipt.effectiveGasPrice !== undefined) {
                gasPrice = receipt.effectiveGasPrice;
            } else {
                const txDetails = await ethers.provider.getTransaction(tx.hash);
                gasPrice = txDetails.gasPrice;
            }

            const gasCost = gasUsed * gasPrice;
            const userBalanceAfter = await ethers.provider.getBalance(user.address);

            // Calculate expected payout
            const payoutAmount = (((sellAmount * TOKEN_PRICE_USD) / (10n ** 18n)) * 10n ** 8n) / BNB_PRICE;
            const expectedBalance = userBalanceBefore - gasCost + payoutAmount;

            expect(userBalanceAfter).to.equal(expectedBalance);

            // Check claimed amount was reduced
            const updatedOrderDetails = await token.getOrderDetails(orderNumber);
            expect(updatedOrderDetails.claimedAmount).to.equal(orderDetails.claimedAmount - sellAmount);
        });

        it("Should prevent selling someone else's order", async function () {
            const orderDetails = await token.getOrderDetails(orderNumber);
            const sellAmount = orderDetails.claimedAmount / 2n;

            await expect(
                token.connect(admin).sellToken(ethers.ZeroAddress, sellAmount, orderNumber)
            ).to.be.revertedWith("Not your order");
        });

        it("Should revert if trying to sell more than claimed tokens", async function() {
            const orderDetails = await token.getOrderDetails(orderNumber);
            const sellAmount = orderDetails.claimedAmount + 1n;

            await expect(
                token.connect(user).sellToken(ethers.ZeroAddress, sellAmount, orderNumber)
            ).to.be.revertedWith("Not enough unlocked tokens to sell");
        });

        it("Should allow user to sell for other ERC20 tokens", async function() {
            // Deploy mock USDT
            const MockUSDT = await ethers.getContractFactory("MockERC20");
            const usdt = await MockUSDT.deploy("Tether", "USDT", ethers.parseUnits("1000000", 18));
            await usdt.waitForDeployment();

            // Deploy mock USDT price feed ($1)
            const usdtPriceFeed = await (await ethers.getContractFactory("MockPriceFeed")).deploy(1n * 10n**8n);
            await usdtPriceFeed.waitForDeployment();
            
            // Register token and price feed
            await token.connect(admin).setPrizeFeed(await usdt.getAddress(), await usdtPriceFeed.getAddress());
            
            // Provide liquidity
            await usdt.transfer(await token.getAddress(), ethers.parseUnits("500000", 18));

            const orderDetails = await token.getOrderDetails(orderNumber);
            const sellAmount = orderDetails.claimedAmount / 2n;
            
            await token.connect(user).sellToken(await usdt.getAddress(), sellAmount, orderNumber);

            const userUsdtBalance = await usdt.balanceOf(user.address);
            
            // Calculate expected payout in USDT
            const tokenValueInUsd = (sellAmount * TOKEN_PRICE_USD) / (10n ** 18n);
            const usdtPrice = 1n * 10n**8n;
            const expectedUsdt = (tokenValueInUsd * (10n**8n)) / usdtPrice;
            
            expect(userUsdtBalance).to.equal(expectedUsdt);
        });
    });

    describe("Helper functions", function () {
        beforeEach(async function() {
            // Create multiple orders for testing
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: ethers.parseEther("1") });
            await token.connect(user).buyToken(ethers.ZeroAddress, { value: ethers.parseEther("0.5") });
            await token.connect(admin).buyToken(ethers.ZeroAddress, { value: ethers.parseEther("2") });
        });

        it("Should return correct user order numbers", async function () {
            const userOrders = await token.getUserOrderNumbers(user.address);
            expect(userOrders.length).to.equal(2);
            expect(userOrders[0]).to.equal(1);
            expect(userOrders[1]).to.equal(2);

            const adminOrders = await token.getUserOrderNumbers(admin.address);
            expect(adminOrders.length).to.equal(1);
            expect(adminOrders[0]).to.equal(3);
        });

        it("Should return correct order details", async function () {
            const orderDetails = await token.getOrderDetails(1);
            expect(orderDetails.buyer).to.equal(user.address);
            expect(orderDetails.paymentToken).to.equal(ethers.ZeroAddress);
            expect(orderDetails.totalAmount).to.be.gt(0);
        });

        it("Should return multiple order details", async function () {
            const orderNumbers = [1, 2, 3];
            const orderDetails = await token.getMultipleOrderDetails(orderNumbers);
            
            expect(orderDetails.length).to.equal(3);
            expect(orderDetails[0].buyer).to.equal(user.address);
            expect(orderDetails[1].buyer).to.equal(user.address);
            expect(orderDetails[2].buyer).to.equal(admin.address);
        });
    });
});