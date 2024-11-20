import { Voting } from "./../target/types/voting";
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey } from "@solana/web3.js";
import { assert } from "chai";

describe("Voting", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Voting as Program<Voting>;

  const pollId = new anchor.BN(1);
  const description = "Test Poll";
  const candidateName = "Dick A";
  // const startTime = new anchor.BN(Date.now());
  // const endTime = new anchor.BN(Date.now() + 100000);

  const now = Math.floor(Date.now() / 1000); // Current UNIX timestamp in seconds
  const startTime = new anchor.BN(now - 10); // Start 10 seconds ago
  const endTime = new anchor.BN(now + 60); // End 60 seconds from now

  // PDA Addresses - context account (store program data)
  // determine this one by define the context in main program
  let pollAccount: anchor.web3.PublicKey;
  let candidateAccount: anchor.web3.PublicKey;
  let voterAccount: anchor.web3.PublicKey;

  // Main user keypair
  const owner = anchor.AnchorProvider.local().wallet;
  const user = anchor.web3.Keypair.generate();

  it("Initialized A Poll!", async () => {
    // First step, we need derive the poll PDA account
    [pollAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    // next, we will call the desired function, in this case is initialize function
    await program.methods
      .initialize(pollId, description, startTime, endTime)
      .accounts({
        pollAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    // Then, we fetch the poll account to validate the initialization process
    const poll = await program.account.poll.fetch(pollAccount); // poll struct transform to program.account.poll

    console.log("Poll ID:", poll.pollId.toNumber());

    assert.strictEqual(poll.pollId.toNumber(), pollId.toNumber());
    assert.strictEqual(poll.description, description);
    assert.strictEqual(poll.candidateAmount.toNumber(), 0);
  });

  // Initialize Candidate
  it("Adds a candidate to the poll", async () => {
    [pollAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8)],
      program.programId
    );

    await program.methods
      .initialize(pollId, description, startTime, endTime)
      .accounts({
        pollAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    [candidateAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "be", 8), Buffer.from(candidateName)],
      program.programId
    );

    try {
      await program.methods
        .initializeCandidate(pollId, candidateName)
        .accounts({
          pollAccount,
          candidateAccount,
          signer: owner.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      console.error("Transaction failed:", err);
    }

    const candidate = await program.account.candidate.fetch(candidateAccount);

    console.log("");

    assert.strictEqual(candidate.candidateName, candidateName);
    assert.strictEqual(candidate.candidateVote.toNumber(), 0);
  });

  // Vote for Candidate
  it.only("Votes for a candidate", async () => {
    // Fund user
    const airdropSignature = await provider.connection.requestAirdrop(
      user.publicKey,
      anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(airdropSignature);
  
    // Derive Poll PDA
    [pollAccount] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8)], // Ensure little-endian
      program.programId
    );
  
    // Initialize Poll
    await program.methods
      .initialize(pollId, description, startTime, endTime)
      .accounts({
        pollAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  
    // Derive Candidate PDA
    const [candidateAccount, candidateBump] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8), Buffer.from(candidateName)],
      program.programId
    );
    console.log("Derived Candidate PDA:", candidateAccount.toBase58());
  
    // Initialize Candidate
    await program.methods
      .initializeCandidate(pollId, candidateName)
      .accounts({
        pollAccount,
        candidateAccount,
        signer: owner.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  
    // Derive Voter PDA
    const [voterAccount, voterBump] = await anchor.web3.PublicKey.findProgramAddressSync(
      [pollId.toArrayLike(Buffer, "le", 8), user.publicKey.toBuffer()],
      program.programId
    );
    console.log("Derived Voter PDA:", voterAccount.toBase58());
  
    // Ensure sufficient lamports for rent
    const rentExemption = await provider.connection.getMinimumBalanceForRentExemption(40);
    const balance = await provider.connection.getBalance(user.publicKey);
    if (balance < rentExemption) {
      throw new Error("Insufficient lamports for voter_account initialization.");
    }
  
    // Call Vote
    try {
      await program.methods
        .vote(pollId, candidateName)
        .accounts({
          pollAccount,
          candidateAccount,
          voterAccount,
          signer: user.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([user])
        .rpc();
    } catch (err) {
      console.error("Transaction failed:", err);
      throw err;
    }
  
    // Fetch Candidate Account
    const candidate = await program.account.candidate.fetch(candidateAccount);
    console.log("Candidate Votes After Voting:", candidate.candidateVote.toNumber());
    assert.strictEqual(candidate.candidateVote.toNumber(), 1);
  
    // Fetch Voter Account
    const voter = await program.account.voter.fetch(voterAccount);
    console.log("Voter Account After Voting:", voter);
    assert.strictEqual(voter.pollId.toNumber(), pollId.toNumber());
    assert.strictEqual(voter.voter.toBase58(), user.publicKey.toBase58());
  });
  
  // Prevent Duplicate Votes
  it.skip("Prevents duplicate votes", async () => {
    try {
      // Attempt to vote again
      await program.methods
        .vote(pollId, candidateName)
        .accounts({
          pollAccount,
          candidateAccount,
          voterAccount,
          signer: signer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      assert.fail("Expected an error for duplicate voting");
    } catch (err) {
      // Check for the custom AlreadyVoted error
      assert.strictEqual(err.error.errorCode.code, "AlreadyVoted");
    }
  });

  // Test Invalid Poll ID
  it.skip("Fails for an invalid poll ID", async () => {
    const invalidPollId = new anchor.BN(999); // Non-existent poll
    const invalidVoterAccount = anchor.web3.Keypair.generate();

    try {
      await program.methods
        .vote(invalidPollId, candidateName)
        .accounts({
          pollAccount: invalidPollId,
          candidateAccount,
          voterAccount: invalidVoterAccount.publicKey,
          signer: signer.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      assert.fail("Expected an error for invalid poll ID");
    } catch (err) {
      assert.include(err.message, "AccountNotInitialized");
    }
  });
});
