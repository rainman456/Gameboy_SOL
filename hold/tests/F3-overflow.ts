import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { WagerProgram } from "../target/types/wager_program";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { createMint, createAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { expect } from "chai";
import { TOKEN_ID } from "../target/types/wager_program";

const TOKEN_PROGRAM_ID = anchor.utils.token.TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM_ID = anchor.utils.token.ASSOCIATED_PROGRAM_ID;

describe("F3: Overflow in Kills/Spawns", () => {
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
  let sessionId = "test_overflow";
  let gameSessionPda: PublicKey;
  let vaultPda: PublicKey;

  before(async () => {
    // Fund keypairs
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(gameServer.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player1.publicKey, 1e9));
    await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(player2.publicKey, 1e9));

    // mint = TOKEN_ID;
    mint = await createMint(provider.connection, provider.wallet.payer, provider.wallet.publicKey, null, 9);
    player1Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player1.publicKey);
    player2Token = await createAssociatedTokenAccount(provider.connection, provider.wallet.payer, mint, player2.publicKey);
    await mintTo(provider.connection, provider.wallet.payer, mint, player1Token, provider.wallet.publicKey, 10000000000); // Lots for spams
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

    // Spam pay_to_spawn 7000 times (u16 max 65535, 7000*10 = 70000 > max, wraps)
    for (let i = 0; i < 7000; i++) {
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
        .rpc();
    }

    // Assert overflow
    const gameSession = await program.account.gameSession.fetch(gameSessionPda);
    const player1Index = gameSession.teamA.players.findIndex(p => p.equals(player1.publicKey));
    const spawns = gameSession.teamA.playerSpawns[player1Index];
    expect(spawns).to.be.lessThan(65535, "Spawns should overflow and wrap to low value"); // Assertion: Wrapped

    // Distribute and assert incorrect (under) earnings
    const preBalance = await provider.connection.getTokenAccountBalance(player1Token);
    await program.methods.distributeWinnings(sessionId, 0).accounts({
      gameServer: gameServer.publicKey,
      gameSession: gameSessionPda,
      vault: vaultPda,
      vaultTokenAccount: vaultToken,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    }).remainingAccounts([
      { pubkey: player1.publicKey, isWritable: false, isSigner: false },
      { pubkey: player1Token, isWritable: true, isSigner: false },
      { pubkey: player2.publicKey, isWritable: false, isSigner: false },
      { pubkey: player2Token, isWritable: true, isSigner: false },
    ]).signers([gameServer]).rpc();
    const postBalance = await provider.connection.getTokenAccountBalance(player1Token);
    expect(Number(postBalance.value.amount) - Number(preBalance.value.amount)).to.be.lessThan(7000 * 100, "Earnings under-calculated due to overflow"); // Assertion: Incorrect payout
  });
});