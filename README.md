# CAT CLI

`cli` requires a synced [tracker](https://github.com/CATProtocol/cat-token-box/blob/main/packages/tracker/README.md).

## Installation

```bash
yarn install
```

## Build

```sh
yarn build
```

## Usage

1. Copy [config.example.json](config.example.json) as `config.json`. Update `config.json` with your own configuration.

All commands use the `config.json` in the current working directory by default. You can also specify a customized configuration file with `--config=your.json`.

2. Create a wallet

```bash
yarn cli wallet create
```

You should see an output similar to:

```
? What is the mnemonic value of your account? (default: generate a new mnemonic) ********
Your wallet mnemonic is:  ********
exporting address to the RPC node ... 
successfully.
```

3. Show address

```bash
yarn cli wallet address
```

You should see an output similar to:

```
Your address is bc1plfkwa8r7tt8vvtwu0wgy2m70d6cs7gwswtls0shpv9vn6h4qe7gqjjjf86
```

4. Fund your address

Deposit some satoshis to your address.


5. Show nfts

```bash
yarn cli wallet balances -i c1a1a777a52f765ebfa295a35c12280279edd46073d41f4767602f819f574f82_0
```

You should see an output similar to:

```
┌──────────────────────────────────────────────────────────────────────┬──────────┬─────────┐
│ collectionId                                                         │ symbol   │ localId │
┼──────────────────────────────────────────────────────────────────────┼──────────┼─────────┤
│ 'c1a1a777a52f765ebfa295a35c12280279edd46073d41f4767602f819f574f82_0' │ 'LCAT'   │ 1n      │
│ 'c1a1a777a52f765ebfa295a35c12280279edd46073d41f4767602f819f574f82_0' │ 'LCAT'   │ 0n      │
┴──────────────────────────────────────────────────────────────────────┴──────────┴─────────┘
```

6. Deploy a collection

- deploy with a metadata json:


```bash
yarn cli deploy --metadata=metadata.json
```

`metadata.json`:

- closed mint:


```json
{
    "name": "LCAT",
    "symbol": "LCAT",
    "description": "this is a cat721 nft collection",
    "max": "10"
}
```

- open mint:


```json
{
    "name": "LCAT",
    "symbol": "LCAT",
    "description": "this is a cat721 nft collection",
    "premine": "0",
    "max": "10"
}
```

- deploy with command line options:


- closed mint
   
```bash
yarn cli deploy --name=LCAT --symbol=LCAT --max=10
```

- open mint
   

```bash
yarn cli deploy --name=LCAT --symbol=LCAT --max=10 --premine=0 --openMint
```

You should see an output similar to:

```
Nft collection LCAT has been deployed.
CollectionId: c1a1a777a52f765ebfa295a35c12280279edd46073d41f4767602f819f574f82_0
Genesis txid: c1a1a777a52f765ebfa295a35c12280279edd46073d41f4767602f819f574f82
Reveal txid: d7871b55f88545e0fb4df2a793fea77d0717a7bb7cab3d22a59b72ddb5b51265
```


1. Mint nft

```bash
yarn cli mint -i [collectionId]
```
You should see an output similar to:

```
Minting LCAT NFT in txid: ef9d98eeae21c6bd8aa172cc1d78d9e4e3749a7632e4119f2f2484396f95f5cb ...
```

1. Send nft

```bash
yarn cli send -i [collectionId] -l [localId] [receiver]
```
You should see an output similar to:

```
Sending LCAT:0 nft  to bc1ppresfm876y9ddn3fgw2zr0wj0pl3zanslje9nfpznq3kc90q46rqvm9k07 
in txid: 277eb0198b4fed9a03845d279cf58fc3289e8a68abdd36981381accb8c24ef52
```

-----------------

### FeeRate

`deploy`, `mint`, and `send` commands can all specify a fee rate via option `--fee-rate`.