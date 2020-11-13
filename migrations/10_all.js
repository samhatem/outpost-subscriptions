/* globals artifacts, web3 */

const Subscription = artifacts.require('Subscription')
const deployFramework = require('@superfluid-finance/ethereum-contracts/scripts/deploy-framework')
const deployTestToken = require('@superfluid-finance/ethereum-contracts/scripts/deploy-test-token')
const deploySuperToken = require('@superfluid-finance/ethereum-contracts/scripts/deploy-super-token')
const SuperfluidSDK = require('@superfluid-finance/ethereum-contracts')

const MINIMUM_FLOW_RATE = 1929012345679

async function setupLocalSuperfluid (deployer) {
  global.web3 = web3

  const errorHandler = err => { if (err) throw err }

  await deployFramework(errorHandler)

  const sf = new SuperfluidSDK.Framework({ web3Provider: web3.currentProvider })
  await sf.initialize()

  await deployTestToken(errorHandler, [':', 'fDAI'])
  await deploySuperToken(errorHandler, [':', 'fDAI'])

  return sf
}

module.exports = async function (deployer, _, accounts) {
  const alice = accounts[0]

  let sf
  if ((await web3.eth.net.getId()) === 5 /* goerli */) {
    sf = new SuperfluidSDK.Framework({
      chainId: 5,
      version: process.env.SUPERFLUID_VERSION,
      web3Provider: web3.currentProvider
    })
    await sf.initialize()
  } else {
    console.log('Using local superfluid')
    sf = await setupLocalSuperfluid(deployer)
  }

  const daiAddress = await sf.resolver.get('tokens.fDAI')
  const dai = await sf.contracts.TestToken.at(daiAddress)

  const MINT_AMOUNT = web3.utils.toWei('20000000', 'ether')

  await dai.mint(alice, MINT_AMOUNT, { from: alice })

  console.log('\n\n' + sf.agreements.ida.address + 'IDA ADDRESS\n\n')

  const sub = await deployer.deploy(
    Subscription,
    sf.host.address,
    sf.agreements.cfa.address,
    sf.agreements.ida.address,
    dai.address,
    MINIMUM_FLOW_RATE,
    1
  )

  console.log(`Contract deployed at ${sub.address}`)
}
