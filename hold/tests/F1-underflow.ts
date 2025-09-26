import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program"; // Import fixed TOKEN_ID

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

describe("F1: Underflow in Player Spawns", () => {
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
  let sessionId = "test_underflow";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Fund keypairs
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player2.publicKey, 1e9));

    // Use fixed mint or create (comment if pre-minted)
    // mint = TOKEN_ID; // Assume pre-created
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    player1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player1.publicKey);
    player2Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player2.publicKey);
    
    // Mint tokens to players (use fixed mint if applicable)
    await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.publicKey, 1000000);
    await mintTo(provider.connection, provider.wallet.payer, mint, player2Token, provider.wallet.publicKey, 1000000);
    
    // Derive PDAs
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

  it("Reproduces spawns underflow and inflated earnings", async () => {
    // Expectation: Create pay-to-spawn session
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
      .rpc();

    // Join players (team 0 and 1)
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
      .rpc();

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
      .rpc();

    // Record 11 kills (initial spawns=10, expect underflow wrap to 65535 for u16)
    for (let i = 0; i < 11; i++) {
      await program.methods.recordKill(sessionId, 0, player1.publicKey, 1, player2.publicKey)
        .accounts({
          gameSession: gameSessionPda,
          gameServer: gameServer.publicKey,
        })
        .signers([gameServer])
        .rpc();
    }

    // Fetch state and assert underflow
    const gameSession = await program.account.gameSession.fetch(gameSessionPda);
    const player2Index = gameSession.teamB.players.findIndex(p => p.equals(player2.publicKey));
    const spawns = gameSession.teamB.playerSpawns[player2Index];
    expect(spawns).to.be.greaterThan(10, "Spawns should underflow and wrap around"); // Assertion: Inflated due to wrap

    // Distribute and check inflated earnings (manual balance check)
    const preBalance = await provider.connection.getTokenAccountBalance(player2Token);
    await program.methods.distributeWinnings(sessionId, 1) // Assume team 1 wins for test
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

    const postBalance = await provider.connection.getTokenAccountBalance(player2Token);
    expect(Number(postBalance.value.amount) - Number(preBalance.value.amount)).to.be.greaterThan(1000, "Inflated earnings due to underflow"); // Assertion: Over-payout
  });
});