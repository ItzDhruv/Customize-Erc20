const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying contracts with account:", deployer.address);

  const initialSupply = ethers.utils.parseUnits("1000000", 18); // 1 million tokens

  const Token = await ethers.getContractFactory("customizetoken");
  const token = await Token.deploy(deployer.address, deployer.address, initialSupply);

  await token.deployed();

  console.log("Token deployed to:", token.address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
