// tests/F2-duplicates.ts
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createInitializeAccountInstruction, mintTo, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, ACCOUNT_SIZE } from "@solana/spl-token";
import { expect } from "chai";

describe("F2: Duplicate Player Joins", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const playerA = Keypair.generate();
  const playerB1 = Keypair.generate();
  const playerB2 = Keypair.generate();
  const playerB3 = Keypair.generate();
  let mint = new PublicKey("FptS4mzXxtDB8QajT65P688EgMx2BsbWSQo1r7Vxia8j");
  let playerAToken: PublicKey;
  let playerB1Token: PublicKey;
  let playerB2Token: PublicKey;
  let playerB3Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_duplicates";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(provider.wallet.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerA.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB2.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB3.publicKey, 1e9));

    console.log("Mint:", mint.toBase58()); // Debug
    const playerATokenAccount = Keypair.generate();
    const playerB1TokenAccount = Keypair.generate();
    const playerB2TokenAccount = Keypair.generate();
    const playerB3TokenAccount = Keypair.generate();
    playerAToken = playerATokenAccount.publicKey;
    playerB1Token = playerB1TokenAccount.publicKey;
    playerB2Token = playerB2TokenAccount.publicKey;
    playerB3Token = playerB3TokenAccount.publicKey;

    const rent = await provider.connection.getMinimumBalanceForRentExemption(ACCOUNT_SIZE);

    // Create and initialize playerA token account
    const createIxA = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: playerAToken,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIxA = createInitializeAccountInstruction(playerAToken, mint, playerA.publicKey, TOKEN_PROGRAM_ID);
    const txA = new Transaction().add(createIxA, initIxA);
    await provider.sendAndConfirm(txA, [playerATokenAccount]);

    // Create and initialize playerB1 token account
    const createIxB1 = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: playerB1Token,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIxB1 = createInitializeAccountInstruction(playerB1Token, mint, playerB1.publicKey, TOKEN_PROGRAM_ID);
    const txB1 = new Transaction().add(createIxB1, initIxB1);
    await provider.sendAndConfirm(txB1, [playerB1TokenAccount]);

    // Create and initialize playerB2 token account
    const createIxB2 = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: playerB2Token,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIxB2 = createInitializeAccountInstruction(playerB2Token, mint, playerB2.publicKey, TOKEN_PROGRAM_ID);
    const txB2 = new Transaction().add(createIxB2, initIxB2);
    await provider.sendAndConfirm(txB2, [playerB2TokenAccount]);

    // Create and initialize playerB3 token account
    const createIxB3 = SystemProgram.createAccount({
      fromPubkey: provider.wallet.publicKey,
      newAccountPubkey: playerB3Token,
      space: ACCOUNT_SIZE,
      lamports: rent,
      programId: TOKEN_PROGRAM_ID,
    });
    const initIxB3 = createInitializeAccountInstruction(playerB3Token, mint, playerB3.publicKey, TOKEN_PROGRAM_ID);
    const txB3 = new Transaction().add(createIxB3, initIxB3);
    await provider.sendAndConfirm(txB3, [playerB3TokenAccount]);

    try {
      await mintTo(provider.connection, provider.wallet.payer, mint, playerAToken, provider.wallet.payer, 3000000);
      await mintTo(provider.connection, provider.wallet.payer, mint, playerB1Token, provider.wallet.payer, 1000);
      await mintTo(provider.connection, provider.wallet.payer, mint, playerB2Token, provider.wallet.payer, 1000);
      await mintTo(provider.connection, provider.wallet.payer, mint, playerB3Token, provider.wallet.payer, 1000);
    } catch (error) {
      console.log("Mint error:", error.logs || error);
      throw error;
    }

    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(sessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = getAssociatedTokenAddressSync(mint, vaultPda, true);
  });

  it("Reproduces duplicate joins and unfair winnings", async () => {
    await program.methods.createGameSession(sessionId, new anchor.BN(1000), { winnerTakesAllThreeVsThree: {} })
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

    for (let i = 0; i < 3; i++) {
      await program.methods.joinUser(sessionId, 0)
        .accounts({
          user: playerA.publicKey,
          gameServer: gameServer.publicKey,
          gameSession: gameSessionPda,
          userTokenAccount: playerAToken,
          vault: vaultPda,
          vaultTokenAccount: vaultToken,
          mint: mint,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([playerA])
        .rpc({ skipPreflight: true });
    }

    await program.methods.joinUser(sessionId, 1)
      .accounts({
        user: playerB1.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: playerB1Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerB1])
      .rpc({ skipPreflight: true });

    await program.methods.joinUser(sessionId, 1)
      .accounts({
        user: playerB2.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: playerB2Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerB2])
      .rpc({ skipPreflight: true });

    await program.methods.joinUser(sessionId, 1)
      .accounts({
        user: playerB3.publicKey,
        gameServer: gameServer.publicKey,
        gameSession: gameSessionPda,
        userTokenAccount: playerB3Token,
        vault: vaultPda,
        vaultTokenAccount: vaultToken,
        mint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([playerB3])
      .rpc({ skipPreflight: true });

    const gameSession = await program.account.gameSession.fetch(gameSessionPda);
    const teamPlayers = gameSession.teamA.players.slice(0, 3);
    expect(teamPlayers.every(p => p.equals(playerA.publicKey))).to.be.true("All slots should be the same player");

    const preBalance = await provider.connection.getTokenAccountBalance(playerAToken);
    const remainingAccounts = [
      { pubkey: playerA.publicKey, isWritable: false, isSigner: false },
      { pubkey: playerAToken, isWritable: true, isSigner: false },
      { pubkey: playerA.publicKey, isWritable: false, isSigner: false },
      { pubkey: playerAToken, isWritable: true, isSigner: false },
      { pubkey: playerA.publicKey, isWritable: false, isSigner: false },
      { pubkey: playerAToken, isWritable: true, isSigner: false },
    ];
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
      .remainingAccounts(remainingAccounts)
      .signers([gameServer])
      .rpc({ skipPreflight: true });

    const postBalance = await provider.connection.getTokenAccountBalance(playerAToken);
    expect(Number(postBalance.value.amount) - Number(preBalance.value.amount)).to.be.greaterThan(2000, "Player receives multi-winnings due to duplicates");
  });
});