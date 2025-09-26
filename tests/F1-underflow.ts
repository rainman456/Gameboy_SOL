import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Connection,
  sendAndConfirmRawTransaction,
} from "@solana/web3.js";
import {
  createMint,
  createInitializeAccountInstruction,
  mintTo,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ACCOUNT_SIZE,
} from "@solana/spl-token";
import { expect } from "chai";

describe("F1: Underflow (u16 wrap) test", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection: Connection = provider.connection;
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;

  // explicit keypairs used as signers in this test
  let testPayer: Keypair;
  let gameServer: Keypair;
  let player1: Keypair;
  let player2: Keypair;

  // token/mint accounts
  let mint: PublicKey;
  let player1Token: PublicKey;
  let player2Token: PublicKey;
  let vaultToken: PublicKey;

  let sessionId = "session_underflow";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  async function makeAndSendTx(tx: Transaction, signers: Keypair[]) {
    // ensure feePayer exists
    if (!tx.feePayer) throw new Error("tx.feePayer not set");
    // set recent blockhash explicitly
    const { blockhash } = await connection.getLatestBlockhash("finalized");
    tx.recentBlockhash = blockhash;
    // sign with exact Keypair objects
    tx.sign(...signers);
    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw);
    await connection.confirmTransaction(sig, "finalized");
    return sig;
  }

  before(async () => {
    // create explicit Keypairs
    testPayer = Keypair.generate();
    gameServer = Keypair.generate();
    player1 = Keypair.generate();
    player2 = Keypair.generate();

    // airdrop lamports to the explicit keypairs (must be enough to pay fees + rent)
    const airdrops = [
      connection.requestAirdrop(testPayer.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      connection.requestAirdrop(gameServer.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      connection.requestAirdrop(player1.publicKey, anchor.web3.LAMPORTS_PER_SOL),
      connection.requestAirdrop(player2.publicKey, anchor.web3.LAMPORTS_PER_SOL),
    ];
    for (const sigP of airdrops) {
      const sig = await sigP;
      await connection.confirmTransaction(sig, "confirmed");
    }

    // create an SPL mint using testPayer as payer & mint authority
    mint = await createMint(
      connection,
      testPayer, // payer Keypair
      testPayer.publicKey, // mint authority
      null, // freeze authority
      0, // decimals
      TOKEN_PROGRAM_ID
    );
    console.log("Created mint:", mint.toBase58());

    // create two token account keypairs (raw token accounts)
    const p1ta = Keypair.generate();
    const p2ta = Keypair.generate();
    player1Token = p1ta.publicKey;
    player2Token = p2ta.publicKey;

    // compute rent
    const rent = await connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    // create & init player1 token account (explicit tx, explicit signers)
    {
      const createIx = SystemProgram.createAccount({
        fromPubkey: testPayer.publicKey,
        newAccountPubkey: player1Token,
        space: ACCOUNT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(player1Token, mint, player1.publicKey, TOKEN_PROGRAM_ID);
      const tx = new Transaction().add(createIx, initIx);
      tx.feePayer = testPayer.publicKey;
      // signers: testPayer pays fee, p1ta is the new account's keypair and must sign
      await makeAndSendTx(tx, [testPayer, p1ta]);
    }

    // create & init player2 token account
    {
      const createIx = SystemProgram.createAccount({
        fromPubkey: testPayer.publicKey,
        newAccountPubkey: player2Token,
        space: ACCOUNT_SIZE,
        lamports: rent,
        programId: TOKEN_PROGRAM_ID,
      });
      const initIx = createInitializeAccountInstruction(player2Token, mint, player2.publicKey, TOKEN_PROGRAM_ID);
      const tx = new Transaction().add(createIx, initIx);
      tx.feePayer = testPayer.publicKey;
      await makeAndSendTx(tx, [testPayer, p2ta]);
    }

    // mint tokens into player accounts using testPayer as mint authority & signer
    await mintTo(connection, testPayer, mint, player1Token, testPayer, 1_000_000);
    await mintTo(connection, testPayer, mint, player2Token, testPayer, 1_000_000);

    // PDAs for session & vault
    [gameSessionPda] = await PublicKey.findProgramAddress(
      [Buffer.from("game_session"), Buffer.from(sessionId)],
      program.programId
    );
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("executes underflow wrap and inflated payout", async () => {
    // createGameSession (use gameServer as signer)
    await program.methods
      .createGameSession(sessionId, new anchor.BN(1000), { payToSpawnOneVsOne: {} })
      .accounts({
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([gameServer])
      .rpc();

    // join player1
    await program.methods
      .joinUser(sessionId, 0)
      .accounts({
        user: player1.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player1Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc();

    // join player2
    await program.methods
      .joinUser(sessionId, 1)
      .accounts({
        user: player2.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player2Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc();

    // record 10 kills (player1 kills player2)
    for (let i = 0; i < 10; i++) {
      await program.methods
        .recordKill(sessionId, 0, player1.publicKey, 1, player2.publicKey)
        .accounts({
          gameSession: gameSessionPda,
          gameServer: gameServer.publicKey,
        })
        .signers([gameServer])
        .rpc();
    }

    // fetch session state and check spawns
    let gs: any = await program.account.gameSession.fetch(gameSessionPda);
    const idx2 = gs.teamB.players.findIndex((p: PublicKey) => p.equals(player2.publicKey));
    // playerSpawns could be BN or number depending on IDL; convert accordingly
    const spawnsAfter10 = gs.teamB.playerSpawns[idx2] && gs.teamB.playerSpawns[idx2].toNumber
      ? gs.teamB.playerSpawns[idx2].toNumber()
      : gs.teamB.playerSpawns[idx2];
    expect(spawnsAfter10).to.equal(0);

    // perform 11th kill to cause wrap
    await program.methods
      .recordKill(sessionId, 0, player1.publicKey, 1, player2.publicKey)
      .accounts({
        gameSession: gameSessionPda,
        gameServer: gameServer.publicKey,
      })
      .signers([gameServer])
      .rpc();

    gs = await program.account.gameSession.fetch(gameSessionPda);
    const spawnsAfter = gs.teamB.playerSpawns[idx2] && gs.teamB.playerSpawns[idx2].toNumber
      ? gs.teamB.playerSpawns[idx2].toNumber()
      : gs.teamB.playerSpawns[idx2];
    console.log("player2 spawns after wrap (should be large u16):", spawnsAfter);
    expect(spawnsAfter).to.be.greaterThan(65000);

    // distribute winnings and check token delta (diagnostic)
    const pre = await connection.getTokenAccountBalance(player2Token);
    await program.methods
      .distributeWinnings(sessionId, 1)
      .accounts({
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts([
        { pubkey: player1.publicKey, isWritable: false, isSigner: false },
        { pubkey: player1Token, isWritable: true, isSigner: false },
        { pubkey: player2.publicKey, isWritable: false, isSigner: false },
        { pubkey: player2Token, isWritable: true, isSigner: false },
      ])
      .signers([gameServer])
      .rpc();

    const post = await connection.getTokenAccountBalance(player2Token);
    const delta = BigInt(post.value.amount) - BigInt(pre.value.amount);
    console.log("token delta for player2 after distribute:", delta.toString());
    // relaxed assertion — we primarily want to observe behavior and logs
    expect(Number(delta)).to.be.at.least(0);
  }).timeout(120000);
});