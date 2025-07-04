const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contract with account:", deployer.address);

  const initialSupply = ethers.parseUnits("1000000", 18); // Example: 1 million tokens
  const owner = deployer.address;
  const admin = deployer.address;

  const Token = await ethers.getContractFactory("customizetoken");
  const token = await Token.deploy(owner, admin, initialSupply);

  await token.waitForDeployment(); // ✅ Use this for ethers v6

  console.log("Contract deployed to:", token.target); // ✅ token.target instead of token.address
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
