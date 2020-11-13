// SPDX-License-Identifier: MIT
pragma solidity 0.7.3;

import {
    ISuperfluid,
    ISuperToken,
    ISuperAgreement,
    ISuperApp,
    SuperAppDefinitions
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    ERC20WithTokenInfo,
    IERC20
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/tokens/ERC20WithTokenInfo.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import {
    IInstantDistributionAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IInstantDistributionAgreementV1.sol";

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Subscription is ISuperApp, Ownable {
    using SafeMath for uint256;

    int96 private _minFlowRate;
    uint32 private _idaIndex;

    ISuperfluid private _host;
    IConstantFlowAgreementV1 private _cfa;
    IInstantDistributionAgreementV1 private _ida;

    ISuperToken private _acceptedSuperToken;
    IERC20 private _acceptedERC20Token;

    EnumerableSet.AddressSet private _subscriptionSet;
    EnumerableSet.AddressSet private _rewardSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    event Distribution(uint32 index);

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        IInstantDistributionAgreementV1 ida,
        ERC20WithTokenInfo acceptedToken,
        int96 minFlowRate,
        uint32 idaIndex
    ) {
        assert(address(host) != address(0));
        assert(address(cfa) != address(0));
        assert(address(ida) != address(0));
        assert(address(acceptedToken) != address(0));

        _host = host;
        _cfa = cfa;
        _ida = ida;

        uint256 configWord =
            SuperAppDefinitions.TYPE_APP_FINAL;

        _host.registerApp(configWord);

        // get acceptedSuperToken from acceptedERC20Token
        _acceptedERC20Token = acceptedToken;
        (address acceptedWrapper,) = _host.getERC20Wrapper(
            IERC20(address(_acceptedERC20Token)),
            string(abi.encodePacked(acceptedToken.symbol(), "x"))
        );
        _acceptedSuperToken = ISuperToken(acceptedWrapper);

        _idaIndex = idaIndex;
        _minFlowRate = minFlowRate;

        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.createIndex.selector,
                _acceptedSuperToken,
                _idaIndex,
                new bytes(0)
            )
        );
    }

    function idaIndex () public view returns (uint32) {
        return _idaIndex;
    }

    function minFlowRate () public view returns (int96) {
        return _minFlowRate;
    }

    function acceptedSuperToken () public view returns (address) {
        return address(_acceptedSuperToken);
    }

    function acceptedERC20Token () public view returns (address) {
        return address(_acceptedERC20Token);
    }

    function hasSubscription (address user) public view returns (bool) {
        return _subscriptionSet.contains(user);
    }

    function hasApprovedReward (address user) public view returns (bool) {
        return _rewardSet.contains(user);
    }

    function setMinFlowRate (int96 newMinFlowRate) external onlyOwner {
        _minFlowRate = newMinFlowRate;
    }

    // should ideally compensate gas cost for caller
    function distributeReward () public {
        // update subscriptions for members of reward set
        uint256 i = 0;
        while (i < _rewardSet.length()) {
            address user = _rewardSet.at(i);

            uint256 balance = _acceptedERC20Token.balanceOf(user);

            _host.callAgreement(
                _ida,
                abi.encodeWithSelector(
                    _ida.updateSubscription.selector,
                    _acceptedSuperToken,
                    _idaIndex,
                    user,
                    balance,
                    new bytes(0)
                )
            );

            if (balance > 0) {
                i++;
            } else {
                _rewardSet.remove(user);
            }
        }

        (uint256 actualAmount,) = _ida.calculateDistribution(
            _acceptedSuperToken,
            address(this),
            _idaIndex,
            _acceptedSuperToken.balanceOf(address(this))
        );

        // distribute tokens
        _host.callAgreement(
            _ida,
            abi.encodeWithSelector(
                _ida.distribute.selector,
                _acceptedSuperToken,
                _idaIndex,
                actualAmount,
                new bytes(0)
            )
        );

        emit Distribution(_idaIndex);
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

    // register for reward
    function _registerForReward (address user) private returns (bool success) {
        uint256 balance = _acceptedERC20Token.balanceOf(user);
        require(balance > 0, "Insufficient balance to register for the reward.");

        _rewardSet.add(user);
        success = true;
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
        returns (bytes memory)
    {
        require(superToken == _acceptedSuperToken, "UnsupportedToken");
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
        if (_isCFAv1(agreementClass)) {
            (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
            require(flowRate >= _minFlowRate, "Subscription flow too low.");

            _subscriptionSet.add(sender);
        } else if (_isIDAv1(agreementClass)) {
            (,,address subscriber,,) = _host.decodeCtx(ctx);
            _registerForReward(subscriber);
        }

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
        require(superToken == _acceptedSuperToken, "UnsupportedToken");
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
        if (_isCFAv1(agreementClass)) {
            (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
            require(flowRate >= _minFlowRate, "Subscription flow too low.");

            _subscriptionSet.add(sender);
        } else if (_isIDAv1(agreementClass)) {
            (,,address subscriber,,) = _host.decodeCtx(ctx);
            _registerForReward(subscriber);
        }

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
        if (_isSameToken(superToken) && (_isCFAv1(agreementClass) || _isIDAv1(agreementClass))) return new bytes(1);
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

        _subscriptionSet.remove(sender);
        newCtx = ctx;
    }

    function _isSameToken(ISuperToken superToken) private view returns (bool) {
        return address(superToken) == address(_acceptedSuperToken);
    }

    function _isCFAv1(address agreementClass) private pure returns (bool) {
        return ISuperAgreement(agreementClass).agreementType()
            == keccak256("org.superfluid-finance.agreements.ConstantFlowAgreement.v1");
    }

    function _isIDAv1(address agreementClass) private view returns (bool) {
        return agreementClass == address(_ida);
    }

    modifier onlyHost() {
        require(msg.sender == address(_host), "Subscription: support only one host");
        _;
    }

    modifier onlyExpected(ISuperToken superToken, address agreementClass) {
        require(_isSameToken(superToken), "Subscription: not accepted token");
        require(_isCFAv1(agreementClass) || _isIDAv1(agreementClass),
            "Subscription: only CFAv1 or IDAv1 supported"
        );
        _;
    }
}
