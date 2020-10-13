const SubscriptionV0 = artifacts.require('SubscriptionV0')
const TestToken = artifacts.require('TestToken')
const { wad4human } = require('@decentral.ee/web3-helpers')
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");


const MINIMUM_FLOW_RATE = 1929012345679

let subscription
let rewardToken
let acceptedToken
let alice
let sf
let dai


contract('SubscriptionV0', accounts => {
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

    alice = accounts[0]
    subscription = await SubscriptionV0.deployed()
    rewardAddress = await subscription.rewardToken()
    rewardToken = await TestToken.at(rewardAddress)
    await dai.mint(alice, web3.utils.toWei("100", "ether"), { from: alice })
    const daiBalance = await dai.balanceOf(alice)
  })

  it ('should have reward balance of 1000000', async () => {
    const rewardBalance = await subscription.rewardBalance()
    assert.equal(rewardBalance.toString() / 1e18, 1000000, 'Initial balance incorrect')
  })

  it ('creates flow and sends reward token back', async () => {
    // approve unlimited dai
    await dai.approve(
      acceptedToken.address,
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
      { from: alice }
    )

    call = [
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
    const rewardFlow = await sf.agreements.cfa.getFlow(rewardToken.address, subscription.address, alice)

    assert.equal(paymentFlow.flowRate, MINIMUM_FLOW_RATE, 'payment should flow at minimum flow rate')
    assert.equal(rewardFlow.flowRate, MINIMUM_FLOW_RATE, 'reward should flow at minimum flow rate')
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
    const rewardFlow = await sf.agreements.cfa.getFlow(rewardToken.address, subscription.address, alice)

    assert.equal(paymentFlow.flowRate, updatedFlow, 'payment should double')
    assert.equal(rewardFlow.flowRate, updatedFlow, 'reward should double')
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
    const rewardFlow = await sf.agreements.cfa.getFlow(rewardToken.address, subscription.address, alice)

    assert.equal(rewardFlow.flowRate, 0, 'Reward Flow should be 0 after delete')
    assert.equal(paymentFlow.flowRate, 0, 'Payment flow should be 0 after delete')
  })
})
