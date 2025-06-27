const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Dtoken TOKEN", function () {
  let owner, admin, newAdmin, user, token;

  beforeEach(async function () {
    [owner, admin, newAdmin, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("customizetoken");
    token = await Token.deploy(owner.address, admin.address, ethers.parseUnits("10000000000", 18));
    await token.waitForDeployment();
  });


          it("Deployment should assign the total supply of tokens to the contract address and set owner and admin address", async function () {
            const tokenAddress = await token.getAddress();
            const contractBalance = await token.balanceOf(tokenAddress);

            expect(await token.totalSupply()).to.equal(contractBalance);
            expect(await token.admin()).to.equal(admin.address);
            expect(await token.owner()).to.equal(owner.address);
          });

          it("Only Admin can change admin", async function () {
            expect(await token.admin()).to.equal(admin.address);

            await token.connect(admin).changeAdmin(newAdmin.address);

            expect(await token.admin()).to.equal(newAdmin.address);
          });

          it("Should revert if non-admin tries to change admin", async function () {
            await expect(
              token.connect(user).changeAdmin(newAdmin.address)
            ).to.be.revertedWith("Only admin can perform this task");

            expect(await token.admin()).to.equal(admin.address);
          });

        it("Allow buying token with BNB", async function () {
          const amount = ethers.parseUnits("1000", 18);

          // Calculate required BNB   1 BNB = 1000 tokens
          const requiredEth = amount / 1000n;  // 

        
          await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });

          const vestingInfo = await token.vesting(user.address, 0);
          expect(vestingInfo.totalAmount).to.equal(amount);
        });


      it("User can buy multiple order", async function () {
        const amount = ethers.parseUnits("1000", 18);

        // Calculate required BNB   1 BNB = 1000 tokens
        const requiredEth = amount / 1000n;  // 

        // Perform purchase
        await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });

        // Validate vesting info stored
        const vestingInfo = await token.vesting(user.address, 0);
        expect(vestingInfo.totalAmount).to.equal(amount);

        await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });
        const vestingInfo2 = await token.vesting(user.address, 1);
        expect(vestingInfo2.totalAmount).to.equal(amount);

      });
          
      
     it("User can claim 10% tokens after 1 year + 1 month lock period", async function () {
        const amount = ethers.parseUnits("1000", 18);
        const requiredEth = amount / 1000n;

        // User buys tokens
        await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth }); // 1000 lidha

        // Fast-forward 1 year + 1 month
        await network.provider.send("evm_increaseTime", [(365 + 30) * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // Claim tokens
        await token.connect(user).claimTokens(0);

        // Check claimed amount should be exactly 10%
        const vestingInfo = await token.vesting(user.address, 0);
        const expectedClaimed = amount / 10n;

        expect(vestingInfo.claimedAmount).to.equal(expectedClaimed);
});

  it("User can claim 100% tokens after 1 year + 10 month lock period", async function () {
        const amount = ethers.parseUnits("1000", 18);
        const requiredEth = amount / 1000n;

        // User buys tokens
        await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth }); // 1000 lidha

        // Fast-forward 1 year + 1 month
        await network.provider.send("evm_increaseTime", [(365 + 300) * 24 * 60 * 60]);
        await network.provider.send("evm_mine");

        // Claim tokens
        await token.connect(user).claimTokens(0);

        // Check claimed amount should be exactly 10%
        const vestingInfo = await token.vesting(user.address, 0);
        const expectedClaimed = amount ;

        expect(vestingInfo.claimedAmount).to.equal(expectedClaimed);
});


 





  // it("Should revert if user tries to buy more than available BNB", async function () {





  it("Should revert when trying to sell more tokens than claimed", async function () {
    const amount = ethers.parseUnits("1000", 18);
    const requiredEth = amount / 1000n;

    // User buys tokens
    await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });

    // Fast-forward 1 year + 1 month (only 10% unlocked)
    await network.provider.send("evm_increaseTime", [(365 + 30) * 24 * 60 * 60]);
    await network.provider.send("evm_mine");

    // Claim 10% tokens
    await token.connect(user).claimTokens(0);

    // Try to sell more than claimed amount
    await token.connect(user).approve(await token.getAddress(), amount);
    
    await expect(
      token.connect(user).sellToken(ethers.ZeroAddress, amount, 0)
    ).to.be.revertedWith("Not enough unlocked tokens to sell");
  });

  it("Should revert when trying to sell zero amount", async function () {
    await expect(
      token.connect(user).sellToken(ethers.ZeroAddress, 0, 0)
    ).to.be.revertedWith("Amount must be greater than 0");
  });


  it("User can sell claimed tokens for BNB", async function () {
  const amount = ethers.parseUnits("1000", 18); // 1000 tokens

  // Provide BNB liquidity to the contract
  await owner.sendTransaction({
    to: await token.getAddress(),
    value: ethers.parseEther("10"),
  });

  // User buys tokens with BNB
  const requiredEth = amount / 1000n; // 1 BNB = 1000 tokens
  await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });

  // Fast-forward 1 year + 10 months for full claim unlock
  await network.provider.send("evm_increaseTime", [(365 + 300) * 24 * 60 * 60]);
  await network.provider.send("evm_mine");

  // Claim tokens
  await token.connect(user).claimTokens(0);

  // Approve DToken contract to spend user's NQ tokens
  await token.connect(user).approve(await token.getAddress(), amount);

  // Record user's BNB balance before selling
  const userBalanceBefore = await ethers.provider.getBalance(user.address);

  // Sell tokens for BNB
  const tx = await token.connect(user).sellToken(ethers.ZeroAddress, amount, 0);
  const receipt = await tx.wait();

  // Record user's BNB balance after selling
  const userBalanceAfter = await ethers.provider.getBalance(user.address);

  // User's BNB balance should have increased (excluding gas costs)
  expect(userBalanceAfter).to.be.gt(userBalanceBefore);
});



  it("User can sell claimed tokens for USDT payout", async function () {
  const amount = ethers.parseUnits("1000", 18); // 1000 DToken tokens
  const usdtAmount = ethers.parseUnits("10000", 18); // Mock USDT liquidity

  // Deploy Mock USDT token
  const MockToken = await ethers.getContractFactory("MockERC20");
  const usdt = await MockToken.deploy("MockUSDT", "USDT", usdtAmount);
  await usdt.waitForDeployment();

  // Deploy Mock Price Feed for USDT
  const MockFeed = await ethers.getContractFactory("MockPriceFeed");
  const priceFeed = await MockFeed.deploy(ethers.parseUnits("1", 8)); // Price: $1 with 8 decimals
  await priceFeed.waitForDeployment();

  // Register USDT & price feed in DToken
  await token.connect(admin).setPrizeFeed(await usdt.getAddress(), await priceFeed.getAddress());

  // Provide USDT liquidity to DToken contract
  await usdt.transfer(await token.getAddress(), usdtAmount);

  // User buys DToken tokens with BNB
  const requiredEth = amount / 1000n; // 1 BNB = 1000 tokens
  await token.connect(user).buyToken(amount, ethers.ZeroAddress, { value: requiredEth });

  // Fast-forward 1 year + 10 months for full claim unlock
  await network.provider.send("evm_increaseTime", [(365 + 300) * 24 * 60 * 60]);
  await network.provider.send("evm_mine");

  // Claim tokens
  await token.connect(user).claimTokens(0);

  // Approve DToken contract to spend user's NQ tokens
  await token.connect(user).approve(await token.getAddress(), amount);

  // Record user's USDT balance before selling
  const userUSDTBefore = await usdt.balanceOf(user.address);

  // Sell tokens for USDT payout
  await token.connect(user).sellToken(await usdt.getAddress(), amount, 0);

  // Record user's USDT balance after selling
  const userUSDTAfter = await usdt.balanceOf(user.address);

  // User's USDT balance should have increased
  expect(userUSDTAfter).to.be.gt(userUSDTBefore);
});



});
