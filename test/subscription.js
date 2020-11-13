/* globals describe, before, it, web3, artifacts, assert */

const Subscription = artifacts.require('Subscription')
const TestToken = artifacts.require('TestToken')
const SuperfluidSDK = require('@superfluid-finance/ethereum-contracts')
const { expectRevert } = require('@openzeppelin/test-helpers')
const traveler = require('ganache-time-traveler')

const MINIMUM_FLOW_RATE = 1929012345679

let subContract
let superDai
let sf
let dai
let alice
let bob

contract('Subscription', accounts => {
  before(async () => {
    console.log(accounts, 'THE ACCOUNTS')
    alice = accounts[0]
    bob = accounts[1]

    if ((await web3.eth.net.getId()) === 5 /* goerli */) {
      console.log('Using goerli superfluid')
      sf = new SuperfluidSDK.Framework({
        chainId: 5,
        version: process.env.SUPERFLUID_VERSION,
        web3Provider: web3.currentProvider
      })
    } else {
      sf = new SuperfluidSDK.Framework({ web3Provider: web3.currentProvider })
    }
    await sf.initialize()

    subContract = await Subscription.deployed()
    const superDaiAddress = await subContract.acceptedSuperToken()
    superDai = await sf.contracts.ISuperToken.at(superDaiAddress)

    const daiBasic = await subContract.acceptedERC20Token()
    dai = await TestToken.at(daiBasic)

    await dai.mint(alice, web3.utils.toWei('10000', 'ether'), { from: alice })
    await dai.mint(bob, web3.utils.toWei('1000000', 'ether'), { from: bob })
  })

  it('has no subscription initially', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, false, 'Should not has a subscription before tests')
  })

  it('allows approving subscription', async () => {
    const idaIndex = await subContract.idaIndex()

    await sf.host.callAgreement(
      sf.agreements.ida.address,
      sf.agreements.ida.contract.methods.approveSubscription(
        superDai.address,
        subContract.address,
        idaIndex.toNumber(),
        "0x"
      ).encodeABI(),
      { from: bob }
    )
  })

  it('creates flow', async () => {
    // approve unlimited dai
    await dai.approve(
      superDai.address,
      '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      { from: alice }
    )

    const call = [
      [
        2, // upgrade 100 daix
        superDai.address,
        sf.web3.eth.abi.encodeParameters(
          ['uint256'],
          [sf.web3.utils.toWei('100', 'ether').toString()]
        )
      ],
      [
        4, // create constant flow (10/mo)
        sf.agreements.cfa.address,
        sf.agreements.cfa.contract.methods
          .createFlow(
            superDai.address,
            subContract.address,
            MINIMUM_FLOW_RATE.toString(),
            '0x'
          )
          .encodeABI()
      ]
    ]

    await sf.host.batchCall(call, { from: alice })

    const paymentFlow = await sf.agreements.cfa.getFlow(superDai.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, MINIMUM_FLOW_RATE, 'payment should flow at minimum flow rate')
  })

  it('updates subContract set', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, true, 'Has subContract should be true after creating flow')
  })

  it('updates a flow', async () => {
    const updatedFlow = MINIMUM_FLOW_RATE * 100
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.updateFlow(
        superDai.address,
        subContract.address,
        updatedFlow.toString(),
        '0x'
      )
        .encodeABI(),
      { from: alice }
    )

    const paymentFlow = await sf.agreements.cfa.getFlow(superDai.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, updatedFlow, 'payment should double')
  })

  it('has a subscription', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, true, 'Has subContract should be true after creating flow')
  })

  it('passes a bunch of time', async () => {
    for (let i = 0; i < 10; i++) {
      await traveler.advanceBlock()
    }
  })

  it('terminates a flow', async () => {
    await sf.host.callAgreement(sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods.deleteFlow(
        superDai.address,
        alice,
        subContract.address,
        '0x'
      )
        .encodeABI(),
      { from: alice }
    )

    console.log('after terminate flow')

    const paymentFlow = await sf.agreements.cfa.getFlow(superDai.address, alice, subContract.address)

    assert.equal(paymentFlow.flowRate, 0, 'Payment flow should be 0 after delete')
  })

  it('updates subContract to false after deleting flow', async () => {
    const hasSubscription = await subContract.hasSubscription(alice)
    assert.equal(hasSubscription, false, 'should not have subContract after terminating flow')
  })

  it('distributes reward', async () => {
    const prevBalance = await superDai.balanceOf(bob)
    const contractBalance = await superDai.balanceOf(subContract.address)

    console.log(bob, 'BOBS ADDRESS')

    const tx = await subContract.distributeReward({ from: alice })

    const distribution = tx.logs.filter(log => log.event === 'Distribution')[0]

    const bobBalance = await dai.balanceOf(bob)

    const newBalance = await superDai.balanceOf(bob)
    const newContractBalance = await superDai.balanceOf(subContract.address)

    expect(Number(newBalance)).to.be.above(Number(prevBalance))
  })
})
