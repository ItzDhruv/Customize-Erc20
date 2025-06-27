

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;



import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";


contract Niqox is ERC20, Ownable{

        address public admin;
        uint256 public tokenPrizeUsdt = 100000000000000000; // 0.1 dollar 
        
        address[] public buyers;
        uint256 public soldTokens;
        uint256 public nextPriceIncreaseThreshold;

         // fatch bnb prize from chainlink data feed 
     AggregatorV3Interface public priceFeed; 
     mapping(address => AggregatorV3Interface) priceFeeds;
   
    

     mapping(address => IERC20) tokenContracts;
                                         
            struct VestingInfo {                   //  for locked token
                        uint256 totalAmount;
                        uint256 startTime;
                        uint256 claimedAmount;
            }

        mapping (address =>mapping(uint256 => VestingInfo)) public vesting;   
        mapping (address => uint256) public userOrders;

            modifier onlyAdmin(){
                require(msg.sender == admin, "Only admin can perform this task");
                _;
            }

        event BuyTokenWithUsdt(address buyer, uint256 amount);
        event BuyToken(address buyer, address tokenPayment, uint256 amount, uint256 cost);
        event BuyTokenWithBnb(address buyer, uint256 amount, uint256 cost);

        event ClaimedToken(address user, uint256 amount);
        event TimelineChanged(address user, uint256 newTime);
        event TokenSold(address user, address payoutToken, uint256 tokenAmount, uint256 payoutAmount);



            constructor (address _owner, address _admin, uint256 _initialSupply)  ERC20("Niqox", "NQ") Ownable (_owner) {
                _mint(address(this), _initialSupply);
                admin = _admin;
                soldTokens = 0;
                nextPriceIncreaseThreshold = totalSupply() / 10; // 10% of total supply

            }
    

    
    function buyToken(uint256 amount, address _tokenPayment) external payable {
            uint256 tokenCost;
    
    if (_tokenPayment == address(0)) {
        // BNB payment 
        tokenCost = amount / 1e3;
        require(msg.value >= tokenCost, "Insufficient BNB sent");

        uint256 orderIndex = userOrders[msg.sender]++;
        vesting[msg.sender][orderIndex] = VestingInfo(amount, block.timestamp, 0);

        emit BuyTokenWithBnb(msg.sender, amount, tokenCost);

    } else {
        // ERC20 token payment
        require(address(priceFeeds[_tokenPayment]) != address(0), "Token not accepted");
        require(address(tokenContracts[_tokenPayment]) != address(0), "Token not registered");

        tokenCost = calculateCost(amount, _tokenPayment);
        require(tokenContracts[_tokenPayment].allowance(msg.sender, address(this)) >= tokenCost, "Insufficient allowance");

        tokenContracts[_tokenPayment].transferFrom(msg.sender, address(this), tokenCost);

        uint256 orderIndex = userOrders[msg.sender]++;
        vesting[msg.sender][orderIndex] = VestingInfo(amount, block.timestamp, 0);
        soldTokens += amount;

        
        emit BuyToken(msg.sender, _tokenPayment, amount, tokenCost);
    }
}

            
      function claimTokens(uint256 _ordernumber) external {

            VestingInfo storage info = vesting[msg.sender][_ordernumber];
            require(info.totalAmount > 0, "No tokens vested");

            uint256 unlockStart = info.startTime + 365 days;
            require(block.timestamp >= unlockStart, "Tokens are still locked");

            uint256 monthsPassed = (block.timestamp - unlockStart) / 30 days;

            if (monthsPassed > 10) {
                monthsPassed = 10;
            }

            uint256 totalUnlocked = (info.totalAmount * monthsPassed) / 10;
            uint256 claimable = totalUnlocked - info.claimedAmount;
            require(claimable > 0, "Nothing to claim yet");

            info.claimedAmount += claimable;
            _transfer(address(this), msg.sender, claimable);
            emit ClaimedToken(msg.sender, claimable);
        }
      




            function changeTimeline(address user, uint256 newStartTime, uint256 _ordernumber) external onlyAdmin {

                require(vesting[user][_ordernumber].totalAmount > 0, "User has no vested tokens");
                vesting[user][_ordernumber].startTime = newStartTime;
                emit TimelineChanged(user, newStartTime);
            }

            function withdrawAll(address tokenAddress) external onlyOwner{                  // bnb and usdt pacha leva
                payable(msg.sender).transfer(address(this).balance);
                tokenContracts[tokenAddress].transfer(msg.sender,  tokenContracts[tokenAddress].balanceOf(address(this)));
            }      

            function changeOwner (address _newOwner) external onlyOwner{
                transferOwnership(_newOwner);
                    }

            function changeAdmin (address _newAdmin) external  onlyAdmin {
            admin = _newAdmin ;
                    }


//             function getLatestBNBPrice() public view returns (uint256) {
//                 (, int256 price,,,) = priceFeed.latestRoundData();
//                 require(price > 0, "Invalid price feed");
//                 return uint256(price); // Price with 8 decimals
// }

            
             function calculateClaimable(address user, uint256 _ordernumber) external view returns (uint256) {
                    VestingInfo memory info = vesting[user][_ordernumber];
                    if (info.totalAmount == 0) return 0;
                    
                    uint256 unlockStart = info.startTime + 365 days;
                    if (block.timestamp < unlockStart) return 0;
                    
                    uint256 monthsPassed = (block.timestamp - unlockStart) / 30 days;
                    if (monthsPassed > 10) monthsPassed = 10;
                    
                    uint256 totalUnlocked = (info.totalAmount * monthsPassed) / 10;
                    return totalUnlocked > info.claimedAmount ? totalUnlocked - info.claimedAmount : 0;
    }
    

    function getAllUsersDetails(address user, uint256 totalOrders) external view returns (VestingInfo[] memory) {
    VestingInfo[] memory infos = new VestingInfo[](totalOrders);

    for (uint256 i = 0; i < totalOrders; i++) {
        infos[i] = vesting[user][i];
    }
    
    return infos;
}

function sellToken(address payoutToken, uint256 amount, uint256 _orderNumber) external {
    require(amount > 0, "Amount must be greater than 0");
    require(amount <= vesting[msg.sender][_orderNumber].claimedAmount, "Not enough unlocked tokens to sell");

    if (payoutToken == address(0)) {
    // BNB payout
    uint256 bnbAmount = amount/1e3;
    require(address(this).balance >= bnbAmount, "Not enough BNB balance");

    _transfer(msg.sender, address(this), amount);
    payable(msg.sender).transfer(bnbAmount);
    vesting[msg.sender][_orderNumber].claimedAmount -= amount;

    emit TokenSold(msg.sender, payoutToken, amount, bnbAmount);
}



    else {
        // Token payout
        require(address(priceFeeds[payoutToken]) != address(0), "Token not accepted");
        require(address(tokenContracts[payoutToken]) != address(0), "Token not registered");

        uint256 payoutTokenPrice = getLatestTokenPrize(payoutToken);
        require(payoutTokenPrice > 0, "Invalid token price");

        uint256 tokenValueInUsd = amount * tokenPrizeUsdt / 1e18;
        uint256 payoutAmount = tokenValueInUsd * 1e8 / payoutTokenPrice;

        require(tokenContracts[payoutToken].balanceOf(address(this)) >= payoutAmount, "Not enough payout token balance");

        _transfer(msg.sender, address(this), amount);

        tokenContracts[payoutToken].transfer(msg.sender, payoutAmount);
        vesting[msg.sender][_orderNumber].claimedAmount -= amount;

   
        emit TokenSold(msg.sender, payoutToken, amount, payoutAmount);

    }
}



   


     function setPrizeFeed(address _tokenaddress, address _pricefeedAddress) public onlyAdmin {
        priceFeeds[_tokenaddress] = AggregatorV3Interface(_pricefeedAddress);
        tokenContracts[_tokenaddress] = IERC20(_tokenaddress);
       }

     function getLatestTokenPrize(address _token) public view returns (uint256){         // for all token
                  (, int256 price,,,) = priceFeeds[_token].latestRoundData();
                require(price > 0, "Invalid price feed");
                return uint256(price);
            }



    function calculateCost(uint256 amount, address _tokenPayment) public view returns (uint256) {
                uint256 totalSupplyTokens = totalSupply();
                uint256 stepSize = totalSupplyTokens / 10; // 10% steps
                uint256 basePrice = tokenPrizeUsdt;

                uint256 currentSold = soldTokens;

                // How many full steps already completed   
                uint256 completedSteps = currentSold / stepSize;

                // Remaining tokens in current price band
                uint256 tokensLeftInCurrentBand = stepSize - (currentSold % stepSize);

                uint256 totalCost = 0;
                uint256 price = basePrice + (basePrice * 2 * completedSteps) / 100;
                uint256 remaining = amount;

                if (remaining <= tokensLeftInCurrentBand) {
                    totalCost = (remaining * price) / 1e18;
                    return totalCost;
                }

                // Cost for tokens in current band
                totalCost += (tokensLeftInCurrentBand * price) / 1e18;
                remaining -= tokensLeftInCurrentBand;
                completedSteps += 1;

                // Full bands calculation (geometric progression)
                uint256 fullBands = remaining / stepSize;
                if (fullBands > 0) {
                    uint256 priceMultiplierNumerator = 102**fullBands;
                    uint256 priceMultiplierDenominator = 100**fullBands;

                    uint256 priceSumFactor = (priceMultiplierNumerator - priceMultiplierDenominator) * price;
                    priceSumFactor /= (2 * priceMultiplierDenominator);

                    totalCost += (stepSize * priceSumFactor) / 1e18;
                }

                // Remaining tokens in next band
                uint256 remainingTokensInNextBand = remaining % stepSize;
                if (remainingTokensInNextBand > 0) {
                    uint256 nextPrice = price * (102**fullBands) / (100**fullBands);
                    totalCost += (remainingTokensInNextBand * nextPrice) / 1e18;
                }
             uint256 tokenLatestPrize = getLatestTokenPrize(_tokenPayment);
             uint256 finlePrize = tokenLatestPrize * totalCost / 1e8;

                return finlePrize;
}





        // Add this function to your Niqox contract


receive() external payable {}

}
