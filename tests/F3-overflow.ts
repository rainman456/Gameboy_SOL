// tests/F3-overflow.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeAccountInstruction, mintTo, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, ACCOUNT_SIZE } from "@solana/spl-token";
import { expect } from "chai";

describe("F3: Overflow in Kills/Spawns", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  let mint = new PublicKey("FptS4mzXxtDB8QajT65P688EgMx2BsbWSQo1r7Vxia8j");
  let player1Token: PublicKey;
  let player2Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_overflow";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(provider.wallet.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player2.publicKey, 1e9));

    console.log("Mint:", mint.toBase58()); // Debug
    const player1TokenAccount = Keypair.generate();
    const player2TokenAccount = Keypair.generate();
    player1Token = player1TokenAccount.publicKey;
    player2Token = player2TokenAccount.publicKey;

    const rent = await provider.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    // Create and initialize player1 token account
    const createIx1 = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: player1Token,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIx1 = createInitializeAccountInstruction(player1Token, mint, player1.publicKey, TOKEN_PROGRAM_ID);
    const tx1 = new Transaction().add(createIx1, initIx1);
    await provider.sendAndConfirm(tx1, [player1TokenAccount]);

    // Create and initialize player2 token account
    const createIx2 = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: player2Token,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIx2 = createInitializeAccountInstruction(player2Token, mint, player2.publicKey, TOKEN_PROGRAM_ID);
    const tx2 = new Transaction().add(createIx2, initIx2);
    await provider.sendAndConfirm(tx2, [player2TokenAccount]);

    try {
      await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.payer, 1000000);
      await mintTo(provider.connection, provider.wallet.payer, mint, player2Token, provider.wallet.payer, 1000000);
    } catch (error) {
      console.log("Mint error:", error.logs || error);
      throw error;
    }

    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(sessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("Reproduces spawns overflow and incorrect earnings", async () => {
    await program.methods.createGameSession(sessionId, new anchor.BN(1000), { payToSpawnOneVsOne: {} })
      .accounts({
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .signers([gameServer])
      .rpc({ skipPreflight: true });

    await program.methods.joinUser(sessionId, 0)
      .accounts({
        user: player1.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player1Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player1])
      .rpc({ skipPreflight: true });

    await program.methods.joinUser(sessionId, 1)
      .accounts({
        user: player2.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: player2Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([player2])
      .rpc({ skipPreflight: true });

    let overflowError;
    for (let i = 0; i < 6554; i++) {
      try {
        await program.methods.payToSpawn(sessionId, 0)
          .accounts({
            user: player1.publicKey,
            gameServer: gameServer.publicKey,
            gameSession: gameSessionPda,
            userTokenAccount: player1Token,
            vault: vaultPda,
            vaultTokenAccount: vaultToken,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([player1])
          .rpc({ skipPreflight: true });
      } catch (error) {
        console.log(`PayToSpawn ${i} error:`, error.logs || error);
        overflowError = error;
        break;
      }
    }

    const gameSession = await program.account.gameSession.fetch(gameSessionPda);
    const player1Index = gameSession.teamA.players.findIndex(p => p.equals(player1.publicKey));
    const spawns = gameSession.teamA.playerSpawns[player1Index];
    expect(spawns).to.be.lessThan(65535, "Spawns should overflow and wrap to low value");

    const preBalance = await provider.connection.getTokenAccountBalance(player1Token);
    await program.methods.distributeWinnings(sessionId, 0)
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
      .rpc({ skipPreflight: true });
    const postBalance = await provider.connection.getTokenAccountBalance(player1Token);
    expect(Number(postBalance.value.amount) - Number(preBalance.value.amount)).to.be.lessThan(6554 * 100, "Earnings under-calculated due to overflow");
  });
});