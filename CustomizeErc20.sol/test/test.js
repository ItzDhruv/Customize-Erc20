const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("NIQOX TOKEN", function () {
  let owner, admin, newAdmin, user, token;

  beforeEach(async function () {
    [owner, admin, newAdmin, user] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Niqox");
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

    it("", async function(){
      
    })


});
