pragma solidity 0.6.12;

import {
    ISuperfluid,
    ISuperToken,
    ISuperApp,
    SuperAppDefinitions
} from "@superfluid-finance/ethereum-contracts/contracts/interfaces/superfluid/ISuperfluid.sol";

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol"

contract Subscription is ISuperApp, Ownable {

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
        assert(address(rewardToken)) != address(0));

        _host = host;
        _cfa = cfa;
        _acceptedToken = acceptedToken;
        _rewardToken = rewardToken;

        uint256 configWord =
            SuperAppDefinitions.TYPE_APP_FINAL;

        _host.registerApp(configWord);
    }


    // function to deposit the return token

    // check balance of return token

    // SUPER APP CALLBACKS

    function beforeAgreementCreated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory cbdata)
    {}

    function afterAgreementCreated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {}

    function beforeAgreementUpdated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId
    )
        external view override
        onlyHost
        onlyExpected(superToken, agreementClass)
        returns (bytes memory cbdata)
    {}


    function afterAgreementUpdated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {}


    function beforeAgreementTerminated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId
    )
        external view override
        onlyHost
        returns (bytes memory cbdata)
    {}


    function afterAgreementTerminated(
        ISuperToken superToken,
        bytes calldata ctx,
        address agreementClass,
        bytes32 agreementId,
        bytes calldata cbdata
    )
        external override
        onlyHost
        returns (bytes memory newCtx)
    {}

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
