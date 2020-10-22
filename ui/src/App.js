import React, { useCallback, useEffect, useState } from "react";

import { Web3Provider } from "@ethersproject/providers";
import { useQuery } from "@apollo/react-hooks";
import AnimatedNumber from "animated-number-react";
import {
  Body,
  Button,
  Header,
  BoxContainer,
  Box,
  ShrinkBox,
  Center,
  Span,
  Div100,
  Post
} from "./components";
import { web3Modal, logoutOfWeb3Modal } from "./utils/web3Modal";
import { flowForHumans, showTick } from "./utils/utils";

import GET_TRANSFERS from "./graphql/subgraph";
const TruffleContract = require("@truffle/contract");

const APP_ADDRESS = "0x6aAc0056211DE4B2F04241A99aF5D4Fb98bD0aeB"; // previous one, with 5 plyaers in "0x358495191298BC25f5c3bD0f3d64C0CC17aC6f2E";
const REWARD_TOKEN_ADDR = '0x36324ACDda35aef68Ed701aFbe7355d7aC522555'
const REWARD_WRAPPER = '0x882a1112CE3D2d0d2Dab99f8e980Db5c4014223b'

const MINIMUM_GAME_FLOW_RATE = "3858024691358";
const Subscription = TruffleContract(require("./SubscriptionV1.json"));

const { wad4human } = require("@decentral.ee/web3-helpers");

const SuperfluidSDK = require("@superfluid-finance/ethereum-contracts");

function WalletButton({ provider, userAddress, loadWeb3Modal }) {
  return (
    <Button
      onClick={() => {
        console.log(provider, 'THE PROVIDER')
        if (!provider) {
          loadWeb3Modal();
        } else {
          logoutOfWeb3Modal();
        }
      }}
    >
      {!provider ? (
        "Connect Wallet"
      ) : (
        <>
          <span>"Disconnect Wallet"</span>
          <br />
          <small>{userAddress.slice(0, 10) + "..."}</small>
        </>
      )}
    </Button>
  );
}

let sf;
let dai;
let daix;
let app;
let rewardToken
let rewardX

function App() {
  const { loading, error, data } = useQuery(GET_TRANSFERS);
  const [provider, setProvider] = useState();
  const [daiApproved, setDAIapproved] = useState(0);
  const [joinedLottery, setJoinedLottery] = useState();
  const [userAddress, setUserAddress] = useState("");
  const [winnerAddress, setWinnerAddress] = useState("");
  const [daiBalance, setDaiBalance] = useState(0);
  const [daixBalance, setDaixBalance] = useState(0);
  const [daixBalanceFake, setDaixBalanceFake] = useState(0);
  const [userNetFlow, setUserNetFlow] = useState(0);
  const [hasSubscription, setHasSubscription] = useState(false)

  async function mintDAI(amount = 100) {
    //mint some dai here!  100 default amount
    console.log('minting dai')
    await dai.mint(
      userAddress,
      sf.web3.utils.toWei(amount.toString(), "ether"),
      { from: userAddress }
    );
    setDaiBalance(wad4human(await dai.balanceOf.call(userAddress)));
    console.log(wad4human(await dai.balanceOf.call(userAddress)), 'DAI BALANCE')
  }

  async function approveDAI() {
    //approve unlimited please
    await dai
      .approve(
        daix.address,
        "115792089237316195423570985008687907853269984665640564039457584007913129639935",
        { from: userAddress }
      )
      .then(async i =>
        setDAIapproved(
          wad4human(await dai.allowance.call(userAddress, daix.address))
        )
      );
  }

  async function handleSubscribe() {
    setDaiBalance(wad4human(await dai.balanceOf.call(userAddress)));
    setDaixBalance(wad4human(await daix.balanceOf.call(userAddress)));
    var call;
    if (daixBalance < 2) {
      call = [
        [
          2, // upgrade 100 daix to play the game
          daix.address,
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
              daix.address,
              app.address,
              MINIMUM_GAME_FLOW_RATE.toString(),
              "0x"
            )
            .encodeABI()
        ]
      ];
      console.log("this is the batchcall: ", call);
      await sf.host.batchCall(call, { from: userAddress });
    } else
      await sf.host.callAgreement(
        sf.agreements.cfa.address,
        sf.agreements.cfa.contract.methods
          .createFlow(
            daix.address,
            app.address,
            MINIMUM_GAME_FLOW_RATE.toString(),
            "0x"
          )
          .encodeABI(),
          { from: userAddress }
      )

    checkSub()
  }

  async function handleTerminate() {
    await sf.host.callAgreement(
      sf.agreements.cfa.address,
      sf.agreements.cfa.contract.methods
        .deleteFlow(daix.address, userAddress, app.address, "0x")
        .encodeABI(),
      { from: userAddress }
    );
  }

  const checkSub = useCallback(async () => {
    const paymentFlow = await sf.agreements.cfa.getFlow(daix.address, userAddress, app.address)
    console.log(paymentFlow.flowRate.toNumber(), 'THE PAYMENT FLOW')

    if (paymentFlow.flowRate.toNumber() > 0) {
      setHasSubscription(true)
    } else {
      setHasSubscription(false)
    }
  }, [userAddress])

  useEffect(() => {
    if (!userAddress) setHasSubscription(false)

    checkSub()
  }, [userAddress, checkSub])

  /* Open wallet selection modal. */
  const loadWeb3Modal = useCallback(async () => {
    const newProvider = await web3Modal.connect();

    newProvider.on("accountsChanged", accounts => {
      console.log("accountsChanged", accounts);
      setUserAddress(accounts[0]);
    });

    sf = new SuperfluidSDK.Framework({
      chainId: 5,
      //version: "master",
      version: "0.1.2-preview-20201014",
      web3Provider: newProvider
    });
    await sf.initialize();

    const daiAddress = await sf.resolver.get("tokens.fDAI");
    dai = await sf.contracts.TestToken.at(daiAddress);
    const daixWrapper = await sf.getERC20Wrapper(dai);
    daix = await sf.contracts.ISuperToken.at(daixWrapper.wrapperAddress);
    Subscription.setProvider(newProvider);
    app = await Subscription.at(APP_ADDRESS);

    rewardToken = await sf.contracts.TestToken.at(REWARD_TOKEN_ADDR)
    rewardX = await sf.contracts.ISuperToken.at(REWARD_WRAPPER)

    global.web3 = sf.web3;

    const accounts = await sf.web3.eth.getAccounts();
    setUserAddress(accounts[0]);

    setProvider(new Web3Provider(newProvider));

    checkSub()
  }, [checkSub]);

  /* If user has loaded a wallet before, load it automatically. */
  useEffect(() => {
    if (web3Modal.cachedProvider) {
      loadWeb3Modal();
    }
    // ############################ here you do all the data retrieval: please pull all the current players in the lottery and push them using addPlayer({address, netFlow})
  }, [loadWeb3Modal]);
  function increaseBalance(value) {
    //console.log("netflow: ", userNetFlow / 1e18);
    //console.log("daixBalanceFake: ", daixBalanceFake);
    var newBalance = Number(daixBalanceFake) + (Number(userNetFlow) * 5) / 1e18;
    if (
      (userNetFlow < 0 && newBalance < daixBalanceFake) ||
      (userNetFlow > 0 && newBalance > daixBalanceFake)
    )
      setDaixBalanceFake(newBalance);
  }

  function getLatestFlows(flows) {
    return Object.values(
      flows.reduce((acc, i) => {
        acc[i.args.sender + ":" + i.args.receiver] = i;
        return acc;
      }, {})
    ).filter(i => i.args.flowRate.toString() !== "0");
  }

  return (
    <Body>
      <div>
        <Header>
          <Div100>
            <h2>Superfluid Subscriptions</h2>
          </Div100>
          <WalletButton
            userAddress={userAddress}
            provider={provider}
            loadWeb3Modal={loadWeb3Modal}
          />
        </Header>
        <BoxContainer
          winner={
            !joinedLottery
              ? "notPlaying"
              : winnerAddress === userAddress
              ? "winner"
              : "loser"
          }
        >
          <Box>
            <div>
              <p> Your DAI balance: {daiBalance}</p>
              <p>
                {" "}
                Your DAIx balance:
                <AnimatedNumber
                  value={daixBalanceFake}
                  complete={increaseBalance}
                  duration={5000}
                />
              </p>
              <p>
                {" "}
                Your net flow:{" "}
                <Span color={userNetFlow > 0 ? "green" : "red"}>
                  {flowForHumans(userNetFlow)}
                </Span>
              </p>
            </div>
          </Box>
          <Box></Box>
          <ShrinkBox>
            <Button onClick={() => mintDAI()}>
              1. Mint some DAI{" "}
              {showTick(
                (daiBalance >= 2 && daiBalance !== "0") || daixBalance > 2
              )}
            </Button>
            <Button onClick={() => approveDAI()}>
              2. Approve DAI{" "}
              {showTick(Number(daiApproved) > 0 && daiApproved !== "0")}
            </Button>
            <Button onClick={() => handleSubscribe()} disabled={joinedLottery}>
              3. Subscribe
            </Button>
            <Button onClick={() => handleTerminate()} disabled={!joinedLottery}>
              4. End Subscription
            </Button>
          </ShrinkBox>
        </BoxContainer>
        <Div100>
          <Center>
            {hasSubscription &&
              <Post>
              <h2>A Sweet Blog Post</h2>
              <p>We hear polarizing responses when we tell people we're building tools for creators. Some have said, "There's definitely something here. Someone's going to hit this big," but we've also heard, "Everyone and their mother has tried building tools for creators. You want to use blockchain too? Oof! Yeah, good luck with that." We are going to address the latter group here, explaining our bet on web3 media.</p><p>First, let's go over the evolution of media on the internet. In the first stage of the web, web1, people needed their own website to share content. Owning a website comes with a lot of control, but setting up one is difficult and it was hard to interact with others. Enter web2 and the big social networks. Sites like Facebook and YouTube made it really easy to share content and interact with others, but users gave up a lot of control. Big tech companies own these sites and get to choose who can post, what content is okay, and who can make money. Now, builders are creating the next generation of the web, web3, an internet centered around user ownership. Web3 has the potential to combine the control of owning your own website with the ease of the big social networks.</p><p>Media in web3 will be owned by its users, creating a major shift in how users interact. Media in web2 largely consists of content creators and consumers. Creators make content and with enough consumers on the other end, advertisers pay so that consumers will also watch their ads. User-owned networks change this dynamic, though. Content creators can become community leaders and consumers become members. We believe this model will be more fulfilling for creators for consumers and also give each much more upside. Ultimately, our bet is that this is a 10x better model that will siphon major users off web2 platforms in the next few years. Let's first explain why this is so much better and then we'll explain how we see the transition happening.</p><p>Media on web3 will be 10x better by offering content creators more control and better incentives. They'll be able to focus on the quality of their fan base instead of quality. [Passion economy](https://a16z.com/2019/10/08/passion-economy/) products like Substack and OnlyFans started this transition away from advertising based models, and now emerging [ownership economy](https://variant.fund/the-ownership-economy-crypto-and-consumer-software/) products will take this to another level.</p><p>More control will unlock new tools for monetization. Soon it will be the norm for creators to offer exclusive content, priority access to merch drops and in-person experiences to their biggest fans. In crypto this is beginning to emerge with social tokens, cryptocurrencies that represent stake in a person or online community. Abridged's [Collab.Land](https://collab.land/) telegram and discord bots recently grew to over [40k users](</p><div class="tweet" data-attrs="{&quot;url&quot;:&quot;https://twitter.com/OKDunc/status/1314065374480986114)&quot;,&quot;full_text&quot;:&quot;40K 😸🤫\n\nThrilled for the chance to work with such an innovative userbase to help build and refine <span class=\&quot;tweet-fake-link\&quot;>@Collab_Land_</span>... new features on the way 🛳 ! &quot;,&quot;username&quot;:&quot;OKDunc&quot;,&quot;name&quot;:&quot;jamesduncan.eth 😸&quot;,&quot;date&quot;:&quot;Thu Oct 08 04:49:34 +0000 2020&quot;,&quot;photos&quot;:[],&quot;quoted_tweet&quot;:{&quot;full_text&quot;:&quot;30K users now touching the @Collab_Land_ system 🤲🤖 https://t.co/FtrqnUZSuR&quot;,&quot;username&quot;:&quot;OKDunc&quot;,&quot;name&quot;:&quot;jamesduncan.eth 😸&quot;},&quot;retweet_count&quot;:2,&quot;like_count&quot;:34,&quot;expanded_url&quot;:{}}"><a href="https://twitter.com/OKDunc/status/1314065374480986114)" target="_blank"><div class="tweet-header"><img class="tweet-user-avatar" src="https://cdn.substack.com/image/twitter_name/w_36/OKDunc.jpg" /><span class="tweet-author-name">jamesduncan.eth 😸 </span><span class="tweet-author">@OKDunc</span></div>40K 😸🤫

              Thrilled for the chance to work with such an innovative userbase to help build and refine <span class="tweet-fake-link">@Collab_Land_</span>... new features on the way 🛳 ! <div class="quoted-tweet"><p><span class="quote-tweet-name">jamesduncan.eth 😸 </span><span class="quote-tweet-username">@OKDunc</span></p>30K users now touching the @Collab_Land_ system 🤲🤖 https://t.co/FtrqnUZSuR</div><div class="tweet-footer"><p class="tweet-date">October 8th 2020</p><span class="retweets"><span class="rt-count">2</span> Retweets</span><span class="likes"><span class="like-count">34</span> Likes</span></div></a></div><p>in less than 2 months. Outside of crypto, [Nelk](https://www.youtube.com/channel/UCkhxWF5CTMUgxneqAFP96LQ), a raunchy YouTube channel, recently introduced [Send Club](https://club.fullsend.com/), a subscription community with access to unreleased content and private events. We expect to see many others follow because this model is more lucrative and more personal.</p><p>New monetization tools are just one aspect that gives creators a much larger upside on web3. The other major benefit we see is that creators can develop a greater reputation. Right now if you create content on YouTube or TikTok, you're just a YouTube or TikTok creator. You can't develop the same prestige on those platforms as say Disney because anyone can create content on those platforms. Someone with 10 million subscribers and 10 subscribers are both Youtube creators. YouTubers are limited to being YouTubers, and the only way they can outgrow the platform is by leaving it. Traditional media companies like Disney or the New York Times were able to develop prestige over time by owning their content and their distribution. Online creators will soon have the same opportunity.</p><p>Web3 also benefits consumers who can become active members in online communities. They will have access to more intimate relationships with the creators they love. They'll also have access to upside in their community if they own a stake in it. As consumers begin to experience the benefits of being members, we think they'll start pushing more of the creators they love into joining web3, creating a flywheel effect of adoption for web3.</p><p>Next, let's dive into *how* we see this transition happening.</p><p>## The Transition to New Platforms</p><p>Our bet is the transition will start with social tokens. People love ownership and exclusivity which makes social tokens great for [bootstrapping a user-owned community](https://outpost-protocol.com/jamm/post/_QRN1ygqtE26B0GOFT5KTpryO2q2-y63Kj2LEBqYtik). Creators will start using [Roll](https://tryroll.com/) or [Rally](https://rally.io/) for tokens as a toy to reward their biggest fans. For their first time they will have brought their fans from multiple platforms together, something that was never possible on siloed web2 platforms. Once their token is distributed, creators will now be leaders of a community-owned network. It will be too early for many to take a leap of faith and leave existing platforms, so the next step will be setting up new tools around their community.</p><p>Creators will use Collab.Land for messaging groups, and [Zora](https://ourzora.com/) or [Foundation](https://foundation.app/) for exclusive drops. New tools like these with strengthen their existing community by giving more opportunities for fans to interact with creators and support them. By adding more utility to their tokens, creators will drive more demand for them, too. The increased price benefits early token holders and strengthens their ties to the community. Creators that get to this stage will have built a strong community outside of tradition web2 platforms. They will no longer need the large network of web2 platforms because they'll know they have superfans who will follow them wherever they go.</p><p>Creators will now be ready for web3 native platforms. Web3 native platforms will give creators even more control and opportunities. Creators will have all the benefits of owning their own website without actually needing to set one up. Web3 natives platforms will give creators access to tokenized subscriptions, money streaming, and exclusive drops *in* content to reward their their most active fans.</p><p>This transition will start with a handful of pioneers will to try social tokens. More social tokens will lead to better tools. Better tools will allow for better web3 native platforms. Once consumers start using better platforms, they'll get other creators to move, too. Resultantly, we'll see a flywheel effect drive network adoption.</p><p>For the flywheel effect to ensue, web3 platforms will need a comparable user experience to web2 platforms. We think the tech stack is finally there. [Arweave](https://www.arweave.org/) has been an awesome decentralized storage solution which we're storing all of our content on. For the foreseeable future website and server hosting will still be centralized, but we think that just giving users control over their data is enough for now. In terms of wallets, we've found [magic](https://magic.link/) to be the best available for anyone new to web3. There's still a lot to be desired from it, but magic is easy enough that anyone can use it.</p><p>Soon we expect the growth in decentralized finance (DeFi) has seen to be replicated in web3 media. Growth in DeFi exploded because it consists of composable financial primitives that could be built on one another. Now the same thing is starting to happen for online communities through [community legos](https://soci3.substack.com/p/beyond-just-tokens-community-legos). We think web3 networks will be 10x better than their web2 alternatives much sooner than you'd expect.</p>
              </Post>
            }
          </Center>
        </Div100>
      </div>
    </Body>
  );
}

export default App;
