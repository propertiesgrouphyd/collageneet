
"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";

/* ============================================================
   VIDHWAAN NEET — LESSON + CREDENTIAL DATA PROTECTION
   SOURCE:
     public/data/day-001.json ...
     public/data/credentials.json
   OUTPUT:
     dist/data/day-001.dat ...
     dist/data/credentials.dat
   FORMAT:
     [12-byte IV][16-byte authentication tag][encrypted gzip]
   ============================================================ */

const ROOT_DIR = process.cwd();
const SOURCE_DIR = path.join(ROOT_DIR, "public", "data");
const OUTPUT_DIR = path.join(ROOT_DIR, "dist", "data");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const DATA_KEY = process.env.NEET_DATA_KEY;

/* ============================================================
   VALIDATE ENCRYPTION KEY
   ============================================================ */

function getEncryptionKey() {
    if (typeof DATA_KEY !== "string" || DATA_KEY.trim() === "") {
        throw new Error("NEET_DATA_KEY environment variable is missing.");
    }

    const normalizedKey = DATA_KEY.trim();

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalizedKey)) {
        throw new Error("NEET_DATA_KEY is not valid Base64.");
    }

    const key = Buffer.from(normalizedKey, "base64");

    if (key.length !== KEY_LENGTH) {
        throw new Error(
            `NEET_DATA_KEY must decode to exactly ${KEY_LENGTH} bytes. Received ${key.length} bytes.`
        );
    }

    return key;
}

/* ============================================================
   ENCRYPT DATA
   ============================================================ */

function encryptData(sourceBuffer, key) {
    const compressed = zlib.gzipSync(sourceBuffer, { level: 9 });
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const encrypted = Buffer.concat([
        cipher.update(compressed),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    if (authTag.length !== AUTH_TAG_LENGTH) {
        throw new Error("Unexpected authentication tag length.");
    }

    return Buffer.concat([
        iv,
        authTag,
        encrypted
    ]);
}

/* ============================================================
   FIND SOURCE LESSON FILES
   ============================================================ */

function getSourceLessonFiles() {
    if (!fs.existsSync(SOURCE_DIR)) {
        throw new Error(`Source directory does not exist: ${SOURCE_DIR}`);
    }

    return fs.readdirSync(SOURCE_DIR, { withFileTypes: true })
        .filter(entry =>
            entry.isFile() &&
            /^day-\d{3}\.json$/i.test(entry.name)
        )
        .map(entry => entry.name)
        .sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        );
}

/* ============================================================
   VALIDATE SOURCE JSON
   ============================================================ */

function validateSourceJSON(filename, text) {
    let data;

    try {
        data = JSON.parse(text);
    } catch (error) {
        throw new Error(`Invalid JSON in ${filename}: ${error.message}`);
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error(`${filename} does not contain a valid lesson object.`);
    }

    const match = /^day-(\d{3})\.json$/i.exec(filename);

    if (match) {
        const expectedDay = Number(match[1]);

        if (
            data.day !== undefined &&
            Number(data.day) !== expectedDay
        ) {
            throw new Error(
                `${filename} contains day=${data.day}, expected day=${expectedDay}.`
            );
        }
    }

    return data;
}

/* ============================================================
   PROTECT ONE LESSON
   ============================================================ */

function protectLesson(sourceFile, outputFile, key) {
    const sourcePath = path.join(SOURCE_DIR, sourceFile);
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    const sourceText = fs.readFileSync(sourcePath, "utf8");

    validateSourceJSON(sourceFile, sourceText);

    const protectedData = encryptData(
        Buffer.from(sourceText, "utf8"),
        key
    );

    fs.writeFileSync(outputPath, protectedData);

    return {
        sourceBytes: Buffer.byteLength(sourceText, "utf8"),
        protectedBytes: protectedData.length
    };
}

/* ============================================================
   PROTECT CREDENTIALS
   SOURCE: public/data/credentials.json
   OUTPUT: dist/data/credentials.dat
   ============================================================ */

function protectCredentials(key) {
    const sourceFile = "credentials.json";
    const outputFile = "credentials.dat";

    const sourcePath = path.join(SOURCE_DIR, sourceFile);
    const outputPath = path.join(OUTPUT_DIR, outputFile);

    if (!fs.existsSync(sourcePath)) {
        throw new Error(
            `Missing credentials file: ${sourcePath}`
        );
    }

    const sourceText = fs.readFileSync(sourcePath, "utf8");

    let credentials;

    try {
        credentials = JSON.parse(sourceText);
    } catch (error) {
        throw new Error(
            `Invalid JSON in credentials.json: ${error.message}`
        );
    }

    if (
        !credentials ||
        typeof credentials !== "object" ||
        Array.isArray(credentials) ||
        !Array.isArray(credentials.users)
    ) {
        throw new Error(
            "credentials.json must contain a users array."
        );
    }

    if (credentials.users.length === 0) {
        throw new Error(
            "credentials.json contains no users."
        );
    }

    for (let i = 0; i < credentials.users.length; i++) {
        const user = credentials.users[i];

        if (
            !user ||
            typeof user !== "object" ||
            typeof user.username !== "string" ||
            typeof user.password !== "string"
        ) {
            throw new Error(
                `Invalid credentials user at index ${i}. username and password must be strings.`
            );
        }

        if (
            user.active !== undefined &&
            typeof user.active !== "boolean"
        ) {
            throw new Error(
                `Invalid active value for credentials user at index ${i}.`
            );
        }
    }

    const protectedData = encryptData(
        Buffer.from(sourceText, "utf8"),
        key
    );

    fs.writeFileSync(outputPath, protectedData);

    if (!fs.existsSync(outputPath)) {
        throw new Error("credentials.dat was not created.");
    }

    if (fs.statSync(outputPath).size <= IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error("credentials.dat output is unexpectedly empty.");
    }

    return {
        sourceBytes: Buffer.byteLength(sourceText, "utf8"),
        protectedBytes: protectedData.length
    };
}

/* ============================================================
   VERIFY PROTECTED OUTPUT
   ============================================================ */

function verifyProtectedOutput(sourceFiles) {
    const outputFiles = fs.readdirSync(
        OUTPUT_DIR,
        { withFileTypes: true }
    )
        .filter(entry => entry.isFile())
        .map(entry => entry.name)
        .sort((a, b) =>
            a.localeCompare(b, undefined, { numeric: true })
        );

    const datFiles = outputFiles.filter(
        file => /\.dat$/i.test(file)
    );

    const jsonFiles = outputFiles.filter(
        file => /\.json$/i.test(file)
    );

    if (datFiles.length !== sourceFiles.length + 1) {
        throw new Error(
            `Protected file count mismatch. Lessons=${sourceFiles.length}, expected DAT=${sourceFiles.length + 1}, actual DAT=${datFiles.length}.`
        );
    }

    if (jsonFiles.length > 0) {
        throw new Error(
            `Plain JSON files remain in dist/data: ${jsonFiles.join(", ")}`
        );
    }

    for (const sourceFile of sourceFiles) {
        const expectedOutput = sourceFile.replace(/\.json$/i, ".dat");

        if (!datFiles.includes(expectedOutput)) {
            throw new Error(`Missing protected output: ${expectedOutput}`);
        }
    }

    if (!datFiles.includes("credentials.dat")) {
        throw new Error("Missing protected output: credentials.dat");
    }

    return datFiles;
}

/* ============================================================
   MAIN
   ============================================================ */

function main() {
    console.log("");
    console.log("============================================================");
    console.log(" VIDHWAAN NEET — PROTECTING LESSONS + CREDENTIALS");
    console.log("============================================================");
    console.log("");

    const key = getEncryptionKey();

    console.log("Encryption : AES-256-GCM");
    console.log("Compression: gzip level 9");
    console.log("Key        : valid 256-bit Base64 key");
    console.log("");

    const sourceFiles = getSourceLessonFiles();

    if (sourceFiles.length === 0) {
        throw new Error(
            "No public/data/day-*.json lesson files were found."
        );
    }

    console.log(`Source lesson files: ${sourceFiles.length}`);

    /* Recreate output directory to prevent stale files. */
    fs.rmSync(OUTPUT_DIR, {
        recursive: true,
        force: true
    });

    fs.mkdirSync(OUTPUT_DIR, {
        recursive: true
    });

    let totalSourceBytes = 0;
    let totalProtectedBytes = 0;

    /* Protect lessons. */
    for (const sourceFile of sourceFiles) {
        const outputFile = sourceFile.replace(/\.json$/i, ".dat");

        const result = protectLesson(
            sourceFile,
            outputFile,
            key
        );

        totalSourceBytes += result.sourceBytes;
        totalProtectedBytes += result.protectedBytes;

        console.log(`Protected: ${sourceFile} → ${outputFile}`);
    }

    /* Protect credentials. */
    const credentialResult = protectCredentials(key);

    totalSourceBytes += credentialResult.sourceBytes;
    totalProtectedBytes += credentialResult.protectedBytes;

    console.log("Protected: credentials.json → credentials.dat");

    /* Verify all outputs. */
    const datFiles = verifyProtectedOutput(sourceFiles);

    console.log("");
    console.log("============================================================");
    console.log(" VIDHWAAN NEET — PROTECTION COMPLETE");
    console.log("============================================================");
    console.log(`Lessons protected : ${sourceFiles.length}`);
    console.log("Credentials      : protected");
    console.log(`Total DAT files  : ${datFiles.length}`);
    console.log(`Source size      : ${totalSourceBytes} bytes`);
    console.log(`Protected size   : ${totalProtectedBytes} bytes`);
    console.log(`Output directory : ${OUTPUT_DIR}`);
    console.log("");
    console.log("Verified:");
    console.log("  ✓ AES-256-GCM encryption");
    console.log("  ✓ gzip compression");
    console.log("  ✓ Every lesson has a .dat output");
    console.log("  ✓ credentials.dat generated");
    console.log("  ✓ No plain JSON files in dist/data");
    console.log("");
    console.log("PROTECTION: PASSED");
    console.log("");
}

/* ============================================================
   EXECUTE
   ============================================================ */

try {
    main();
} catch (error) {
    console.error("");
    console.error("PROTECTION: FAILED");
    console.error("");
    console.error(error.message);
    console.error("");

    process.exit(1);
}
