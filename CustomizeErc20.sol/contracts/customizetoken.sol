// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

contract customizetoken is ERC20, Ownable{

    address public admin;
    uint256 public tokenPrizeUsdt = 100000000000000000; // 0.1 dollar 
    
    address[] public buyers;
    uint256 public soldTokens;
    uint256 public nextPriceIncreaseThreshold;
    uint256 public currentOrderNumber = 1; // Start from 1, increment for each order

    // Fetch BNB price from chainlink data feed 
    AggregatorV3Interface public priceFeed;
    mapping(address => AggregatorV3Interface) priceFeeds;
    mapping(address => IERC20) tokenContracts;
                                     
    struct VestingInfo {
        uint256 totalAmount;
        uint256 startTime;
        uint256 claimedAmount;
        address buyer;           // Store buyer address in the struct
        address paymentToken;    // Store payment token used
    }

    // Single mapping with unique order numbers
    mapping(uint256 => VestingInfo) public vesting;   
    
    // Track user's order numbers for easy access
    mapping(address => uint256[]) public userOrderNumbers;

    modifier onlyAdmin(){
        require(msg.sender == admin, "Only admin can perform this task");
        _;
    }

    event BuyTokenWithUsdt(address buyer, uint256 orderNumber, uint256 amount);
    event BuyToken(address buyer, address tokenPayment, uint256 orderNumber, uint256 amount, uint256 cost);
    event BuyTokenWithBnb(address buyer, uint256 orderNumber, uint256 amount, uint256 cost);
    event ClaimedToken(address user, uint256 orderNumber, uint256 amount);
    event TimelineChanged(address user, uint256 orderNumber, uint256 newTime);
    event TokenSold(address user, address payoutToken, uint256 orderNumber, uint256 tokenAmount, uint256 payoutAmount);

    constructor (address _owner, address _admin, uint256 _initialSupply)  ERC20("Dtoken", "DT") Ownable (_owner) {
        _mint(address(this), _initialSupply);
        admin = _admin;
        soldTokens = 0;
        nextPriceIncreaseThreshold = totalSupply() / 10; // 10% of total supply
    }

    function setBnbPriceFeed(address _priceFeedAddress) public onlyAdmin {
        priceFeed = AggregatorV3Interface(_priceFeedAddress);
    }
    
    // Modified buyToken function - tokens calculated based on payment amount
    function buyToken(address _tokenPayment) external payable {
        uint256 tokenAmount;
        uint256 actualCost;
        uint256 orderNumber = currentOrderNumber++;
        
        if (_tokenPayment == address(0)) {
            // BNB payment
            require(msg.value > 0, "Must send BNB");
            uint256 bnbPriceUsd = getLatestBNBPrice();
            
            // Calculate USD value of sent BNB
            uint256 usdValue = (msg.value * bnbPriceUsd) / 1e8;
            
            // Calculate how many tokens can be bought with this USD amount
            tokenAmount = calculateTokensFromUsdValue(usdValue);
            actualCost = msg.value;
            
            buyers.push(msg.sender);
            vesting[orderNumber] = VestingInfo(tokenAmount, block.timestamp, 0, msg.sender, _tokenPayment);
            userOrderNumbers[msg.sender].push(orderNumber);
            soldTokens += tokenAmount;

            emit BuyTokenWithBnb(msg.sender, orderNumber, tokenAmount, actualCost);

        } else {
            // ERC20 token payment
            require(address(priceFeeds[_tokenPayment]) != address(0), "Token not accepted");
            require(address(tokenContracts[_tokenPayment]) != address(0), "Token not registered");
            
            // Get allowance amount
            uint256 allowedAmount = tokenContracts[_tokenPayment].allowance(msg.sender, address(this));
            require(allowedAmount > 0, "No allowance given");
            
            // Calculate USD value of allowed tokens
            uint256 tokenPriceUsd = getLatestTokenPrize(_tokenPayment);
            uint256 usdValue = (allowedAmount * tokenPriceUsd) / 1e8;
            
            // Calculate tokens to give
            tokenAmount = calculateTokensFromUsdValue(usdValue);
            actualCost = allowedAmount;
            
            tokenContracts[_tokenPayment].transferFrom(msg.sender, address(this), allowedAmount);
            
            buyers.push(msg.sender);
            vesting[orderNumber] = VestingInfo(tokenAmount, block.timestamp, 0, msg.sender, _tokenPayment);
            userOrderNumbers[msg.sender].push(orderNumber);
            soldTokens += tokenAmount;
            
            emit BuyToken(msg.sender, _tokenPayment, orderNumber, tokenAmount, actualCost);
        }
    }

    // Helper function to calculate tokens from USD value considering price tiers
    function calculateTokensFromUsdValue(uint256 usdValue) internal view returns (uint256) {
        uint256 totalSupplyTokens = totalSupply();
        uint256 stepSize = totalSupplyTokens / 10; // 10% steps
        uint256 basePrice = tokenPrizeUsdt;
        uint256 currentSold = soldTokens;
        
        uint256 remainingUsd = usdValue;
        uint256 totalTokens = 0;
        
        // Calculate current price tier
        uint256 completedSteps = currentSold / stepSize;
        uint256 tokensLeftInCurrentBand = stepSize - (currentSold % stepSize);
        
        while (remainingUsd > 0 && totalTokens < totalSupplyTokens) {
            uint256 currentPrice = basePrice + (basePrice * 2 * completedSteps) / 100;
            uint256 maxTokensInThisBand = tokensLeftInCurrentBand;
            
            // Cost for all remaining tokens in current band
            uint256 costForMaxTokens = (maxTokensInThisBand * currentPrice) / 1e18;
            
            if (remainingUsd >= costForMaxTokens) {
                // Buy all tokens in this band
                totalTokens += maxTokensInThisBand;
                remainingUsd -= costForMaxTokens;
                
                // Move to next band
                completedSteps++;
                tokensLeftInCurrentBand = stepSize;
            } else {
                // Buy partial tokens in this band
                uint256 tokensInThisBand = (remainingUsd * 1e18) / currentPrice;
                totalTokens += tokensInThisBand;
                remainingUsd = 0;
            }
        }
        
        return totalTokens;
    }
            
    function claimTokens(uint256 _orderNumber) external {
        VestingInfo storage info = vesting[_orderNumber];
        require(info.buyer == msg.sender, "Not your order");
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
        emit ClaimedToken(msg.sender, _orderNumber, claimable);
    }

    function changeTimeline(uint256 _orderNumber, uint256 newStartTime) external onlyAdmin {
        require(vesting[_orderNumber].totalAmount > 0, "Order does not exist");
        vesting[_orderNumber].startTime = newStartTime;
        emit TimelineChanged(vesting[_orderNumber].buyer, _orderNumber, newStartTime);
    }

    function withdrawAll(address tokenAddress) external onlyOwner {
        // Withdraw BNB
        if (address(this).balance > 0) {
            payable(msg.sender).transfer(address(this).balance);
        }

        // Withdraw ERC20 tokens only if tokenAddress is provided
        if (tokenAddress != address(0)) {
            require(address(tokenContracts[tokenAddress]) != address(0), "Token not registered");
            uint256 tokenBalance = tokenContracts[tokenAddress].balanceOf(address(this));
            if (tokenBalance > 0) {
                tokenContracts[tokenAddress].transfer(msg.sender, tokenBalance);
            }
        }
    }

    function changeOwner (address _newOwner) external onlyOwner{
        transferOwnership(_newOwner);
    }

    function changeAdmin (address _newAdmin) external  onlyAdmin {
        admin = _newAdmin ;
    }
             
    function calculateClaimable(uint256 _orderNumber) external view returns (uint256) {
        VestingInfo memory info = vesting[_orderNumber];
        if (info.totalAmount == 0) return 0;
        
        uint256 unlockStart = info.startTime + 365 days;
        if (block.timestamp < unlockStart) return 0;
        
        uint256 monthsPassed = (block.timestamp - unlockStart) / 30 days;
        if (monthsPassed > 10) monthsPassed = 10;
        
        uint256 totalUnlocked = (info.totalAmount * monthsPassed) / 10;
        return totalUnlocked > info.claimedAmount ? totalUnlocked - info.claimedAmount : 0;
    }

    // Get all order numbers for a user
    function getUserOrderNumbers(address user) external view returns (uint256[] memory) {
        return userOrderNumbers[user];
    }

    // Get order details by order number
    function getOrderDetails(uint256 _orderNumber) external view returns (VestingInfo memory) {
        return vesting[_orderNumber];
    }

    // Get multiple order details
    function getMultipleOrderDetails(uint256[] memory orderNumbers) external view returns (VestingInfo[] memory) {
        VestingInfo[] memory orders = new VestingInfo[](orderNumbers.length);
        for (uint256 i = 0; i < orderNumbers.length; i++) {
            orders[i] = vesting[orderNumbers[i]];
        }
        return orders;
    }

    function sellToken(address payoutToken, uint256 amount, uint256 _orderNumber) external {
        VestingInfo storage info = vesting[_orderNumber];
        require(info.buyer == msg.sender, "Not your order");
        require(amount > 0, "Amount must be greater than 0");
        require(amount <= info.claimedAmount, "Not enough unlocked tokens to sell");

        if (payoutToken == address(0)) {
            // BNB payout
            uint256 payoutTokenPrice = getLatestBNBPrice();
            uint256 tokenValueInUsd = amount * tokenPrizeUsdt / 1e18;
            uint256 payoutAmount = tokenValueInUsd * 1e8 / payoutTokenPrice;

            require(address(this).balance >= payoutAmount, "Not enough BNB balance");

            _transfer(msg.sender, address(this), amount);
            payable(msg.sender).transfer(payoutAmount);
            info.claimedAmount -= amount;

            emit TokenSold(msg.sender, payoutToken, _orderNumber, amount, payoutAmount);
        } else {
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
            info.claimedAmount -= amount;

            emit TokenSold(msg.sender, payoutToken, _orderNumber, amount, payoutAmount);
        }
    }

    function setPrizeFeed(address _tokenaddress, address _pricefeedAddress) public onlyAdmin {
        priceFeeds[_tokenaddress] = AggregatorV3Interface(_pricefeedAddress);
        tokenContracts[_tokenaddress] = IERC20(_tokenaddress);
    }

    function getLatestTokenPrize(address _token) public view returns (uint256){
        (, int256 price,,,) = priceFeeds[_token].latestRoundData();
        require(price > 0, "Invalid price feed");
        return uint256(price);
    }

    function getLatestBNBPrice() public view returns (uint256) {
        (, int256 price,,,) = priceFeed.latestRoundData();
        require(price > 0, "Invalid price feed");
        return uint256(price); // Price with 8 decimals
    }

    receive() external payable {}
}