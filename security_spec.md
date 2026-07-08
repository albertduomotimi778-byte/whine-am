# Security Specification & Threat Model (Animato Studio)

This document outlines the security architecture, invariants, threat model ("Dirty Dozen" malicious payloads), and rules test specification for Animato Studio.

---

## 1. Data Invariants & Access Control Philosophy

- **User Authentication**: Standard operations must enforce that the user is signed in with a verified account (`request.auth.token.email_verified == true`).
- **User Cloud Projects**: Each cloud project belongs strictly to a single creator, verified by their email. Users can only read, write, update, or delete their own cloud projects (`existing().email == request.auth.token.email`).
- **Dropbox Keys**: Dropbox credentials are system-level configuration parameters. They should be readable by verified creators so they can sync files but strictly read-only for clients (no client writes allowed).
- **Competitions & Submissions**:
  - Competitions and Tutorials are published by Admins (Read-only for users).
  - Competition submissions must tie exactly to the current user's verified email (`incoming().userEmail == request.auth.token.email`). A user cannot submit on behalf of others.
- **Sellers & Referrals**: Restricted settings that are writeable only by admins or authorized roles, preventing identity spoofing or balance tampering.

---

## 2. The "Dirty Dozen" Payloads (Threat Vectors)

Here are the 12 malicious payloads designed to test and break our rulesets. All of these must return `PERMISSION_DENIED` under a secure fortress:

### Pillar 1: Identity Spoofing (Setting Owner to someone else)
1. **Malicious Cloud Backup (Spoofed Owner)**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: `{ "id": "proj_abc", "email": "victim@gmail.com", "name": "Stolen Project", "project_data": "{}", "size_bytes": 100, "updated_at": "2026-07-04" }`
   - *Attacker identity*: `attacker@gmail.com`

2. **Malicious Competition Submission (Spoofed Creator Email)**:
   - *Target Collection*: `competition_submissions`
   - *Payload*: `{ "submissionId": "sub_xyz", "competitionId": "comp_123", "competitionName": "Best Anim", "userEmail": "victim@gmail.com", "formData": {} }`
   - *Attacker identity*: `attacker@gmail.com`

### Pillar 2: System Settings Injection / Unauthorized Writes
3. **Malicious Dropbox Keys Creation**:
   - *Target Collection*: `dropbox_keys`
   - *Payload*: `{ "name": "Fake Key", "apiKey": "malicious-api-key" }`
   - *Attacker identity*: `attacker@gmail.com` (Non-admin)

4. **Malicious Product Price Modification (Amount Tampering)**:
   - *Target Collection*: `products`
   - *Payload*: `{ "id": "premium_brush", "amount": 0, "price": "Free" }` (Updating price from $50 to $0)
   - *Attacker identity*: `attacker@gmail.com` (Non-admin)

### Pillar 3: Denial of Wallet / Resource Exhaustion
5. **Path Poisoning with Huge Document ID (1.5KB Key)**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: Try creating a document with an ID consisting of 1500 'A' characters.
   - *Attacker identity*: `attacker@gmail.com`

6. **Oversized String Payload in Name**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: `{ "id": "proj_123", "email": "attacker@gmail.com", "name": "A" * 10000, "project_data": "{}", "size_bytes": 100, "updated_at": "2026-07-04" }` (Name length exceeds 256 characters limit)
   - *Attacker identity*: `attacker@gmail.com`

### Pillar 4: Shadow Fields / Schema Integrity Violations
7. **Ghost Field Injection (`isAdmin: true`)**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: `{ "id": "proj_123", "email": "attacker@gmail.com", "name": "Project", "project_data": "{}", "size_bytes": 100, "updated_at": "2026-07-04", "isAdmin": true }`
   - *Attacker identity*: `attacker@gmail.com`

8. **Tampered Project Storage Size (Setting size to negative)**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: `{ "id": "proj_123", "email": "attacker@gmail.com", "name": "My Project", "project_data": "{}", "size_bytes": -99999, "updated_at": "2026-07-04" }`
   - *Attacker identity*: `attacker@gmail.com`

### Pillar 5: Unverified Account Access
9. **Unverified Email Writes**:
   - *Target Collection*: `user_cloud_projects`
   - *Payload*: `{ "id": "proj_123", "email": "unverified@gmail.com", "name": "Project", "project_data": "{}", "size_bytes": 100, "updated_at": "2026-07-04" }`
   - *Attacker identity*: `unverified@gmail.com` (`email_verified` is false)

### Pillar 6: Temporal Integrity Violations
10. **Spoofed CreatedAt Timestamp (Client-provided future timestamp)**:
    - *Target Collection*: `product_assets`
    - *Payload*: `{ "productId": "prod_1", "fileName": "asset.png", "chunkIndex": 0, "totalChunks": 1, "data": "base64", "createdAt": 1900000000000 }`
    - *Attacker identity*: `attacker@gmail.com` (Non-admin)

### Pillar 7: PII Data Leaking (Blanket Reads)
11. **Malicious Seller Private Data Retrieval**:
    - *Target Collection*: `sellers`
    - *Action*: Read `/sellers/some_other_seller`
    - *Attacker identity*: `attacker@gmail.com` (Non-owner, Non-admin)

### Pillar 8: Terminal State Locking Bypass
12. **Tampering with Closed Competition Submissions**:
    - *Target Collection*: `competition_submissions`
    - *Action*: Update a submission after it was accepted/locked.
    - *Attacker identity*: `attacker@gmail.com`

---

## 3. The Rules Test Blueprint

The security configuration will validate these constraints via `firestore.rules`.
All operations specified above must be rejected synchronously by the security policy.
