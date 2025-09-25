import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_TOKEN_PROGRAM_ID;

describe("F5: Centralized Game Server Risks", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.WagerProgram as Program<WagerProgram>;
  const gameServer = Keypair.generate();
  const player1 = Keypair.generate();
  const player2 = Keypair.generate();
  let mint: PublicKey;
  let player1Token: PublicKey;
  let player2Token: PublicKey;
  let vaultToken: PublicKey;
  let sessionId = "test_centralized";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player2.publicKey, 1e9));

    // mint = TOKEN_ID;
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    player1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player1.publicKey);
    player2Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player2.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.publicKey, 1000000);
    await mintTo(provider.connection, provider.wallet.payer, mint, player2Token, provider.wallet.publicKey, 1000000);
    
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

  it("Allows server to fake distribution and invalid self-kill", async () => {
    await program.methods.createGameSession(sessionId, new anchor.BN(1000), { winnerTakesAllOneVsOne: {} })
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

    await program.methods.joinUser(sessionId, 0).accounts({
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
    }).signers([player1]).rpc();
    await program.methods.joinUser(sessionId, 1).accounts({
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
    }).signers([player2]).rpc();

    // Simulate fake kill (e.g., self-kill, no check)
    await program.methods.recordKill(sessionId, 0, player1.publicKey, 0, player1.publicKey) // Invalid self-kill
      .accounts({ 
        gameSession: gameSessionPda, 
        gameServer: gameServer.publicKey 
      })
      .signers([gameServer])
      .rpc(); // Succeeds due to no validation

    // Assert self-kill effect (spawns decreased invalidly)
    const gameSessionAfterKill = await program.account.gameSession.fetch(gameSessionPda);
    const player1Index = gameSessionAfterKill.teamA.players.findIndex(p => p.equals(player1.publicKey));
    expect(gameSessionAfterKill.teamA.playerSpawns[player1Index]).to.equal(9, "Self-kill should decrease spawns invalidly");

    // Fake distribute to wrong team (but validation prevents; assert normal behavior for team 0)
    const preBalancePlayer2 = await provider.connection.getTokenAccountBalance(player2Token);
    await program.methods.distributeWinnings(sessionId, 0) // Fake win for team 0
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
        // Only provide team 0 (1v1); team 1 omitted but not paid anyway
      ])
      .signers([gameServer])
      .rpc();

    const postBalancePlayer2 = await provider.connection.getTokenAccountBalance(player2Token);
    expect(Number(postBalancePlayer2.value.amount)).to.equal(Number(preBalancePlayer2.value.amount), "Player2 should not win"); // Assertion: No fake payout to wrong team
  });
});