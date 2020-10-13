// SPDX-License-Identifier: MIT
pragma solidity 0.7.1;

import {
    ISuperfluid,
    ISuperToken,
    ISuperAgreement,
    ISuperApp,
    SuperAppDefinitions
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import {
    IConstantFlowAgreementV1
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/agreements/IConstantFlowAgreementV1.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";

contract SubscriptionV0 is ISuperApp, Ownable {

    /// @dev Minimum flow rate to participate (hardcoded to $5 / mo)
    int96 constant private _MINIMUM_FLOW_RATE = int96(uint256(5e18) / uint256(3600 * 24 * 30));

    ISuperfluid private _host; // host
    IConstantFlowAgreementV1 private _cfa; // the stored constant flow agreement class address
    ISuperToken private _acceptedToken; // accepted token

    ISuperToken private _rewardToken;

    EnumerableSet.AddressSet private _subscriptionSet;
    using EnumerableSet for EnumerableSet.AddressSet;

    constructor(
        ISuperfluid host,
        IConstantFlowAgreementV1 cfa,
        ISuperToken acceptedToken,
        ISuperToken rewardToken
    ) {
        assert(address(host) != address(0));
        assert(address(cfa) != address(0));
        assert(address(acceptedToken) != address(0));
        assert(address(rewardToken) != address(0));

        _host = host;
        _cfa = cfa;
        _acceptedToken = acceptedToken;
        _rewardToken = rewardToken;

        uint256 configWord =
            SuperAppDefinitions.TYPE_APP_FINAL;

        _host.registerApp(configWord);
    }

    function rewardToken () public view returns (address) {
      return address(_rewardToken);
    }

    // check balance of return token
    function rewardBalance () public view returns (uint256) {
        return _rewardToken.balanceOf(address(this));
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

        (,flowRate,,) = IConstantFlowAgreementV1(agreementClass).getFlowByID(_acceptedToken, agreementId);
    }

    // SUPER APP CALLBACKS

    function beforeAgreementCreated(
        ISuperToken superToken,
        bytes calldata /*ctx*/,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory /* data */)
    {
        require(superToken == _acceptedToken, "Unsupported token");
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
        onlyHost
        returns (bytes memory newCtx)
    {
      // create a stream to the sender
      (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
      require(flowRate >= _MINIMUM_FLOW_RATE, "SubV0: Flow too low.");

      newCtx = ctx;

      (newCtx, ) = _host.callAgreementWithContext(
          _cfa,
          abi.encodeWithSelector(
              _cfa.createFlow.selector,
              _rewardToken,
              sender,
              flowRate,
              new bytes(0)
          ),
          newCtx
      );
    }

    function beforeAgreementUpdated(
        ISuperToken superToken,
        bytes calldata /*ctx*/,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory /* data */)
    {
        require(superToken == _acceptedToken, "Unsupported token");
        require(agreementClass == address(_cfa), "Unsupported agreement");
    }

    function afterAgreementUpdated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata /* cbdata */
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {
        // create a stream to the sender
        (address sender, int96 flowRate) = _getFlowInfo(ctx, agreementClass, agreementId);
        require(flowRate >= _MINIMUM_FLOW_RATE, "SubV0: Flow too low.");

        newCtx = ctx;

        (newCtx, ) = _host.callAgreementWithContext(
            _cfa,
            abi.encodeWithSelector(
                _cfa.updateFlow.selector,
                _rewardToken,
                sender,
                flowRate,
                new bytes(0)
            ),
            newCtx
        );
    }

    function beforeAgreementTerminated(
        ISuperToken superToken,
        bytes calldata /* ctx */,
        address agreementClass,
        bytes32 /* agreementId */
    )
        external view override
        onlyHost
        returns (bytes memory /* cbdata */)
    {
        // no idea what should  go here
        if (_isSameToken(superToken) && _isCFAv1(agreementClass)) return new bytes(1);
        return new bytes(0);
    }


    function afterAgreementTerminated(
        ISuperToken /* superToken */,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata /* cbdata */
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {
        (address receiver,) = _getFlowInfo(ctx, agreementClass, agreementId);

        // terminate our stream to the sender
        newCtx = ctx;

        (newCtx,) = _host.callAgreementWithContext(
            _cfa,
            abi.encodeWithSelector(
                _cfa.deleteFlow.selector,
                _rewardToken,
                address(this),
                receiver,
                new bytes(0)
            ),
            newCtx
        );
    }

    function _isSameToken(ISuperToken superToken) private view returns (bool) {
        return address(superToken) == address(_acceptedToken);
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
