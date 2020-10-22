// SPDX-License-Identifier: MIT
pragma solidity 0.7.1;

import {
    ISuperfluid,
    ISuperToken,
    ISuperAgreement,
    ISuperApp,
    SuperAppDefinitions,
    IERC20 as SFIERC20
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import {
    IInstantDistributionAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "@uniswap/v2-periphery/contracts/interfaces/IERC20.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract SubscriptionV1 is ISuperApp, Ownable {
    using SafeMath for uint256;

    uint constant MAX_UINT = 2**256 - 1;

    int96 private _minFlowRate;

    ISuperfluid private _host; // host
    IConstantFlowAgreementV1 private _cfa; // the stored constant flow agreement class address
    IInstantDistributionAgreementV1 private _ida;
    uint32 private _idaIndex = 0;

    IERC20 public _acceptedERC20;
    ISuperToken public _acceptedSuperToken; // accepted token

    IERC20 public _rewardERC20;
    ISuperToken public _rewardSuperToken;

    IUniswapV2Router02 _uniswapRouter;

    // subscription info of subscribers for payouts
    struct SubscriptionInfo {
      int96 curFlowRate;
      uint updateBlock;
      uint128 unitsOwed;
    }

    // subscription info of subscribers
    mapping(address => SubscriptionInfo) private _subInfos;

    // set of all subscribers
    EnumerableSet.AddressSet private _subscriptionSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        IInstantDistributionAgreementV1 ida,
        IERC20 acceptedERC20Token,
        IERC20 rewardToken,
        IUniswapV2Router02 uniswapRouter,
        int96 minFlowRate
    ) {
        assert(address(host) != address(0));
        assert(address(cfa) != address(0));
        assert(address(ida) != address(0));
        assert(address(acceptedERC20Token) != address(0));
        assert(address(rewardToken) != address(0));
        assert(address(uniswapRouter) != address(0));

        _host = host;
        _cfa = cfa;
        _ida = ida;

        uint256 configWord =
            SuperAppDefinitions.TYPE_APP_FINAL;

        _host.registerApp(configWord);

        // get acceptedSuperToken from acceptedERC20Token
        _acceptedERC20 = acceptedERC20Token;
        (address acceptedWrapper,) = _host.getERC20Wrapper(
            SFIERC20(address(acceptedERC20Token)),
            string(abi.encodePacked(acceptedERC20Token.symbol(), "x"))
        );
        _acceptedSuperToken = ISuperToken(acceptedWrapper);

        _rewardERC20 = rewardToken;
        (address rewardWrapper,) = _host.getERC20Wrapper(
            SFIERC20(address(rewardToken)),
            string(abi.encodePacked(rewardToken.symbol(), "x"))
        );
        _rewardSuperToken = ISuperToken(rewardWrapper);

        // set uniswap router
        _uniswapRouter = uniswapRouter;

        _minFlowRate = minFlowRate;

        // approve uniswap router to spend accepted tokens
        _acceptedERC20.approve(address(_uniswapRouter), MAX_UINT);
        // approve rewardSuperToken to spend unlimited reward tokens
        _rewardERC20.approve(address(_rewardSuperToken), MAX_UINT);
    }

    function hasSubscription (address user) public view returns (bool) {
        SubscriptionInfo memory sub = _subInfos[user];
        return sub.curFlowRate >= _minFlowRate;
    }

    function subFlow (address user) public view returns (int96) {
        SubscriptionInfo memory sub = _subInfos[user];
        return sub.curFlowRate;
    }

    function acceptedTokenBalance () public view returns (uint256) {
        return _acceptedSuperToken.balanceOf(address(this));
    }

    function setMinFlowRate (int96 newFlowRate) public onlyOwner {
        _minFlowRate = newFlowRate;
    }

    function distributeReward (uint amountOutMin) public {
        // downgrade super tokens
        uint256 tokenBalance = acceptedTokenBalance();
        _acceptedSuperToken.downgrade(tokenBalance);

        // swap tokens on uniswap
        address[] memory path = new address[](2);
        path[0] = address(_acceptedERC20);
        path[1] = address(_rewardERC20);
        // swap tokens on uniswap for amountOutMin
        _uniswapRouter.swapExactTokensForTokens(
            tokenBalance,
            amountOutMin,
            path,
            address(this),
            block.timestamp
        );

        uint256 rewardBalance = _rewardERC20.balanceOf(address(this));

        // upgrade reward tokens to super tokens
        _rewardSuperToken.upgrade(rewardBalance);

        // create ida and send to all subscribers
        _idaIndex = _idaIndex + 1;
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.createIndex.selector,
                _rewardSuperToken,
                _idaIndex,
                new bytes(0)
            )
        );

        uint i = 0;
        while (i < _subscriptionSet.length()) {
            address user = _subscriptionSet.at(i);
            SubscriptionInfo memory subInfo = _subInfos[user];
            _host.callAgreement(
                _ida,
                abi.encodeWithSelector(
                    _ida.updateSubscription.selector,
                    _rewardSuperToken,
                    _idaIndex,
                    user,
                    _getUnitsOwed(subInfo),
                    new bytes(0)
                )
            );

            if (subInfo.curFlowRate == 0) {
                _subscriptionSet.remove(user);
            } else {
              i++;
            }

            _subInfos[user] = SubscriptionInfo(subInfo.curFlowRate, block.number, 0);
        }

        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.distribute.selector,
                _rewardSuperToken,
                _idaIndex,
                rewardBalance,
                new bytes(0)
            )
        );
    }

    function _getFlowInfo(
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId
    )
        private view
        returns (address sender, int96 flowRate)
    {
        (,,sender,,) = _host.decodeCtx(ctx);

        (,flowRate,,) = IConstantFlowAgreementV1(agreementClass).getFlowByID(_acceptedSuperToken, agreementId);
    }

    function _getUnitsOwed (SubscriptionInfo memory subInfo)
        private view
        returns (uint128 unitsOwed)
    {
        uint blocksPassed = block.number.sub(uint256(subInfo.updateBlock));

        // make sure uint256 -> uint128 conversion doesn't cause error
        uint256 units = blocksPassed.mul(uint256(subInfo.curFlowRate));
        uint128 additionalUnits = uint128(units);

        require(units == additionalUnits, "Unable to convert units to uint128");

        unitsOwed = uint128(uint256(subInfo.unitsOwed).add(additionalUnits));
    }


    // SUPER APP CALLBACKS

    function beforeAgreementCreated(
        ISuperToken superToken,
        bytes calldata /* ctx */,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory /* cbdata */)
    {
        require(superToken == _acceptedSuperToken, "Unsupported token");
        require(agreementClass == address(_cfa), "Unsupported agreement");
    }


    function afterAgreementCreated(
        ISuperToken /* superToken */,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata /* cbdata */
    )
        external override
        returns (bytes memory newCtx)
    {
        (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
        require(flowRate >= _minFlowRate, "SubV0: Flow too low.");

        _subscriptionSet.add(sender);

        SubscriptionInfo memory sub = _subInfos[sender];
        _subInfos[sender] = SubscriptionInfo(flowRate, block.number, sub.unitsOwed);

        newCtx = ctx;
    }


    function beforeAgreementUpdated(
        ISuperToken superToken,
        bytes calldata /* ctx */,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory /* data */)
    {
        require(superToken == _acceptedSuperToken, "Unsupported token");
        require(agreementClass == address(_cfa), "Unsupported agreement");
    }


    function afterAgreementUpdated(
        ISuperToken /* superToken */,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata /* cbdata */
    )
        external override
        returns (bytes memory newCtx)
    {
        (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
        require(flowRate >= _minFlowRate, "SubV0: Flow too low.");

        SubscriptionInfo memory sub = _subInfos[sender];
        _subInfos[sender] = SubscriptionInfo(flowRate, block.number, _getUnitsOwed(sub));

        newCtx = ctx;
    }


    function beforeAgreementTerminated(
        ISuperToken superToken,
        bytes calldata /* ctx */,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external override
        view
        returns (bytes memory /* cbdata */)
    {
        // no idea what should  go here
        if (_isSameToken(superToken) && _isCFAv1(agreementClass)) return new bytes(1);
        return new bytes(0);
    }


    function afterAgreementTerminated(
        ISuperToken /* superToken */,
        bytes calldata ctx,
        address /* agreementClass */,
        bytes32 /* agreementId */,
        bytes calldata /* cbdata */
    )
        external override
        returns (bytes memory newCtx)
    {
        (,,address sender,,) = _host.decodeCtx(ctx);

        SubscriptionInfo memory subInfo = _subInfos[sender];
        _subInfos[sender] = SubscriptionInfo(0, block.number, _getUnitsOwed(subInfo));
        newCtx = ctx;
    }

    function _isSameToken(ISuperToken superToken) private view returns (bool) {
        return address(superToken) == address(_acceptedSuperToken);
    }

    function _isCFAv1(address agreementClass) private pure returns (bool) {
        return ISuperAgreement(agreementClass).agreementType()
            == keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    }

    modifier onlyHost() {
        require(msg.sender == address(_host), "Subscription: support only one host");
        _;
    }

    modifier onlyExpected(ISuperToken superToken, address agreementClass) {
        require(_isSameToken(superToken), "Subscription: not accepted token");
        require(_isCFAv1(agreementClass), "Subscription: only CFAv1 supported");
        _;
    }
}
