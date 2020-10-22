const SubscriptionV1= artifacts.require('SubscriptionV1')
const TestToken = artifacts.require('TestToken')
const { wad4human } = require('@decentral.ee/web3-helpers')
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");

const MINIMUM_FLOW_RATE = 1929012345679

let subContract
let rewardToken
let rewardSuperToken
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

    subContract = await SubscriptionV1.deployed()
    rewardAddress = await subContract._rewardERC20.call()
    rewardToken = await TestToken.at(rewardAddress)
    const rewardWrapper = await sf.getERC20Wrapper(rewardToken)
    rewardSuperToken = await sf.contracts.ISuperToken.at(rewardWrapper.wrapperAddress)

    await dai.mint(alice, web3.utils.toWei("10000", "ether"), { from: alice })
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
            subContract.address,
            MINIMUM_FLOW_RATE.toString(),
            "0x"
          )
          .encodeABI()
      ]
    ]

    await sf.host.batchCall(call, { from: alice })

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, MINIMUM_FLOW_RATE, 'payment should flow at minimum flow rate')
  })

  it ('updates subContract set', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, true, 'Has subContract should be true after creating flow')
  })

  it ('updates a flow', async () => {
    const updatedFlow = MINIMUM_FLOW_RATE * 100
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.updateFlow(
        acceptedToken.address,
        subContract.address,
        updatedFlow.toString(),
        "0x"
      )
      .encodeABI(),
      { from: alice }
    )

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, updatedFlow, 'payment should double')
  })

  it ('distributes the reward', async () => {
    const idaIndex = 42

    const res = await subContract.distributeReward("0", idaIndex)
    const args = res.receipt.logs[0].args
    console.log(args, 'the args from distribute')

    await sf.host.callAgreement(
      sf.agreements.ida.address,
      sf.agreements.ida.contract.methods.claim(
        rewardToken.address, subContract.address, idaIndex.toString(), "0x"
      ).encodeABI(),
      { from: alice }
    )

    const rewardAmount = (await rewardSuperToken.balanceOf(alice)).toString()
    expect(rewardAmount).to.be.above(0)
  })

  it ('terminates a flow', async () => {
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.deleteFlow(
        acceptedToken.address,
        alice,
        subContract.address,
        "0x"
      )
      .encodeABI(),
      { from: alice }
    )

    console.log('after terminate flow')

    const paymentFlow = await sf.agreements.cfa.getFlow(acceptedToken.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, 0, 'Payment flow should be 0 after delete')
  })

  it ('updates subContract to false after deleting flow', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, false, 'should not have subContract after terminating flow')
  })
})
