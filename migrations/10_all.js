const TestToken = artifacts.require('TestToken');
const SubscriptionV1 = artifacts.require('SubscriptionV1')
const deployFramework = require("@superfluid-finance/ethereum-contracts/scripts/deploy-framework");
const deployTestToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-test-token");
const deploySuperToken = require("@superfluid-finance/ethereum-contracts/scripts/deploy-super-token");
const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");
const UniswapV2Factory = artifacts.require('UniswapV2Factory');
const UniswapV2Router02 = artifacts.require('UniswapV2Router02');
const UniswapV2Pair = artifacts.require('UniswapV2Pair');

const tokenName = 'JammSession';

const MINIMUM_FLOW_RATE = 1929012345679

async function setupLocalSuperfluid(deployer) {
  global.web3 = web3;

  const errorHandler = err => { if (err) throw err; };

  await deployFramework(errorHandler);

  let sf = new SuperfluidSDK.Framework({ web3Provider: web3.currentProvider });
  await sf.initialize();

  await deployTestToken(errorHandler, [":", "fDAI"]);
  await deploySuperToken(errorHandler, [":", "fDAI"]);
  await deployer.deploy(TestToken, "JammSession", "JAMM");

  return sf;
}

async function setupUniswap (deployer, acceptedToken, rewardToken, alice) {
  await deployer.deploy(UniswapV2Factory, alice)
  const uniFactory = await UniswapV2Factory.deployed()

  await deployer.deploy(UniswapV2Router02, uniFactory.address, uniFactory.address)
  const uniRouter = await UniswapV2Router02.deployed()

  await createUniPair(uniFactory, acceptedToken, rewardToken)

  return {
    uniFactory,
    uniRouter
  }
}

async function createUniPair (uniFactory, acceptedToken, rewardToken) {
  const tx = await uniFactory.createPair(acceptedToken.address, rewardToken.address)
  const pairAddr = tx.receipt.logs[0].args.pair
  const pair = await UniswapV2Pair.at(pairAddr)
}

module.exports = async function (deployer, _, accounts) {
  const alice = accounts[0]

  let sf;
  if ((await web3.eth.net.getId()) === 5 /* goerli */) {
      console.log("Using goerli superfluid");
      sf = new SuperfluidSDK.Framework({
        chainId: 5,
        version: process.env.SUPERFLUID_VERSION,
        web3Provider: web3.currentProvider
      })
      await sf.initialize();
  } else {
      console.log("Using local superfluid");
      sf = await setupLocalSuperfluid(deployer);
  }

  // MIGRATE THE TEST TOKEN
  const rewardToken = await TestToken.deployed()

  console.log(rewardToken.address, 'address of the created token')

  const tokenInfoName = await rewardToken.name.call();
  const tokenInfoSymbol = await rewardToken.symbol.call();
  const tokenInfoDecimals = await rewardToken.decimals.call();
  console.log("Token address", rewardToken.address);
  console.log("Token name", tokenName);
  console.log("Token info name()", tokenInfoName);
  console.log("Token info symbol()", tokenInfoSymbol);
  console.log("Token info decimals()", tokenInfoDecimals.toString());

  let superTokenWrapper = await sf.getERC20Wrapper(rewardToken)
  if (!superTokenWrapper.created) {
    console.log("Creating the wrapper...");
    //await sf.createERC20Wrapper(rewardToken, alice);
    await sf.host.createERC20Wrapper(
        rewardToken.address,
        tokenInfoDecimals,
        `Super ${tokenInfoName}`,
        `${tokenInfoSymbol}x`, {
            from: alice
        }
    );
    console.log("Wrapper created.");
  } else {
    console.log("SuperToken wrapper already created.");
  }

  const daiAddress = await sf.resolver.get("tokens.fDAI");
  const dai = await sf.contracts.TestToken.at(daiAddress);

  // MIGRATE UNISWAP
  let { uniRouter } = await setupUniswap(deployer, rewardToken, dai, alice)

  const MINT_AMOUNT = web3.utils.toWei("20000000", "ether")

  await rewardToken.mint(alice, MINT_AMOUNT, { from: alice })
  await dai.mint(alice, MINT_AMOUNT, { from: alice })

  await rewardToken.approve(uniRouter.address, MINT_AMOUNT, { from: alice })
  await dai.approve(uniRouter.address, MINT_AMOUNT, { from: alice })

  await uniRouter.addLiquidity(
    rewardToken.address,
    dai.address,
    web3.utils.toWei("1000", "ether"),
    web3.utils.toWei("20000", "ether"),
    web3.utils.toWei("500", "ether"),
    web3.utils.toWei("10000", "ether"),
    alice,
    Date.now() + Date.now(),
    { from: alice }
  )

  const sub = await deployer.deploy(
    SubscriptionV1,
    sf.host.address,
    sf.agreements.cfa.address,
    sf.agreements.ida.address,
    dai.address,
    rewardToken.address,
    uniRouter.address,
    MINIMUM_FLOW_RATE
  )

  console.log(`Contract deployed at ${sub.address}`)
}
