const SubscriptionV1= artifacts.require('SubscriptionV1')
const TestToken = artifacts.require('TestToken')
const { wad4human } = require('@decentral.ee/web3-helpers')
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");

const MINIMUM_FLOW_RATE = 1929012345679

let subscription
let rewardToken
let acceptedToken
let alice = '0x5abBF48D100C4A4c3506F56698Edd96Bb166E55a'
let sf
let dai

describe('SubscriptionV1', accounts => {
  before(async () => {
    if ((await web3.eth.net.getId()) === 5 /* goerli */) {
        console.log("Using goerli superfluid");
        sf = new SuperfluidSDK.Framework({
          chainId: 5,
          version: process.env.SUPERFLUID_VERSION,
          web3Provider: web3.currentProvider
        })
    } else {
        sf = new SuperfluidSDK.Framework({ web3Provider: web3.currentProvider });
    }
    await sf.initialize()

    const daiAddress = await sf.resolver.get("tokens.fDAI");
    dai = await sf.contracts.TestToken.at(daiAddress);
    const daixWrapper = await sf.getERC20Wrapper(dai);
    acceptedToken = await sf.contracts.ISuperToken.at(daixWrapper.wrapperAddress);

    subscription = await SubscriptionV1.deployed()
    rewardAddress = await subscription._rewardERC20.call()
    rewardToken = await TestToken.at(rewardAddress)
    await dai.mint(alice, web3.utils.toWei("100", "ether"), { from: alice })
    const daiBalance = await dai.balanceOf(alice)
  })

  it ('creates flow', async () => {
    // approve unlimited dai
    await dai.approve(
      acceptedToken.address,
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      { from: alice }
    )

    const call = [
      [
        2, // upgrade 100 daix
        acceptedToken.address,
        sf.web3.eth.abi.encodeParameters(
          ["uint256"],
          [sf.web3.utils.toWei("100", "ether").toString()]
        )
      ],
      [
        4, // create constant flow (10/mo)
        sf.agreements.cfa.address,
        sf.agreements.cfa.contract.methods
          .createFlow(
            acceptedToken.address,
            subscription.address,
            MINIMUM_FLOW_RATE.toString(),
            "0x"
          )
          .encodeABI()
      ]
    ]

    await sf.host.batchCall(call, { from: alice })

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subscription.address)

    assert.equal(paymentFlow.flowRate, MINIMUM_FLOW_RATE, 'payment should flow at minimum flow rate')
  })

  it ('updates subscription set', async () => {
    const hasSubscription = await subscription.hasSubscription(alice)
    assert.equal(hasSubscription, true, 'Has subscription should be true after creating flow')
  })

  it ('updates a flow', async () => {
    const updatedFlow = MINIMUM_FLOW_RATE * 2
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.updateFlow(
        acceptedToken.address,
        subscription.address,
        updatedFlow.toString(),
        "0x"
      )
      .encodeABI(),
      { from: alice }
    )

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subscription.address)

    assert.equal(paymentFlow.flowRate, updatedFlow, 'payment should double')
  })

  it ('terminates a flow', async () => {
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.deleteFlow(
        acceptedToken.address,
        alice,
        subscription.address,
        "0x"
      )
      .encodeABI(),
      { from: alice }
    )

    console.log('after terminate flow')

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subscription.address)

    assert.equal(paymentFlow.flowRate, 0, 'Payment flow should be 0 after delete')
  })

  it ('updates subscription to false after deleting flow', async () => {
    const hasSubscription = await subscription.hasSubscription(alice)
    assert.equal(hasSubscription, false, 'should not have subscription after terminating flow')
  })

  it ('distributes the reward', async () => {
    await subscription.distributeReward("0")
  })
})
