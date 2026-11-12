"use strict";

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";


/*
 * ============================================================
 * VIDHWAAN NEET — LESSON DATA PROTECTION
 * ============================================================
 *
 * SOURCE:
 *   public/data/day-001.json
 *   public/data/day-002.json
 *   ...
 *
 * OUTPUT:
 *   dist/data/day-001.dat
 *   dist/data/day-002.dat
 *   ...
 *
 * PROCESS:
 *
 *   JSON
 *     ↓
 *   gzip
 *     ↓
 *   AES-256-GCM encryption
 *     ↓
 *   .dat
 *
 *
 * BINARY FORMAT:
 *
 *   [12-byte IV]
 *   [16-byte authentication tag]
 *   [encrypted gzip payload]
 *
 *
 * IMPORTANT:
 *
 * The encryption key is supplied through:
 *
 *   NEET_DATA_KEY
 *
 * GitHub Actions should provide this through
 * a repository secret.
 *
 * The key must decode from Base64 to exactly
 * 32 bytes (256 bits).
 *
 * ============================================================
 */


/*
 * ============================================================
 * PATHS
 * ============================================================
 */

const ROOT_DIR =
    process.cwd();

const SOURCE_DIR =
    path.join(
        ROOT_DIR,
        "public",
        "data"
    );

const OUTPUT_DIR =
    path.join(
        ROOT_DIR,
        "dist",
        "data"
    );


/*
 * ============================================================
 * CRYPTOGRAPHY
 * ============================================================
 */

const ALGORITHM =
    "aes-256-gcm";

const IV_LENGTH =
    12;

const AUTH_TAG_LENGTH =
    16;

const KEY_LENGTH =
    32;


/*
 * ============================================================
 * ENVIRONMENT KEY
 * ============================================================
 */

const DATA_KEY =
    process.env.NEET_DATA_KEY;


/*
 * ============================================================
 * VALIDATE KEY
 * ============================================================
 */

function getEncryptionKey() {

    if (
        typeof DATA_KEY !== "string" ||
        DATA_KEY.trim() === ""
    ) {
        throw new Error(
            "NEET_DATA_KEY environment variable is missing."
        );
    }


    const normalizedKey =
        DATA_KEY.trim();


    /*
     * Base64 validation.
     *
     * Allow standard Base64 with optional
     * trailing padding.
     */

    if (
        !/^[A-Za-z0-9+/]+={0,2}$/.test(
            normalizedKey
        )
    ) {
        throw new Error(
            "NEET_DATA_KEY is not valid Base64."
        );
    }


    const key =
        Buffer.from(
            normalizedKey,
            "base64"
        );


    if (
        key.length !== KEY_LENGTH
    ) {
        throw new Error(
            `NEET_DATA_KEY must decode to exactly ${KEY_LENGTH} bytes. Received ${key.length} bytes.`
        );
    }


    return key;
}


/*
 * ============================================================
 * FIND SOURCE LESSON FILES
 * ============================================================
 */

function getSourceLessonFiles() {

    if (
        !fs.existsSync(
            SOURCE_DIR
        )
    ) {
        throw new Error(
            `Source directory does not exist: ${SOURCE_DIR}`
        );
    }


    return fs.readdirSync(
        SOURCE_DIR,
        {
            withFileTypes: true
        }
    )
        .filter(entry =>
            entry.isFile() &&
            /^day-\d{3}\.json$/i.test(
                entry.name
            )
        )
        .map(entry =>
            entry.name
        )
        .sort(
            (a, b) =>
                a.localeCompare(
                    b,
                    undefined,
                    {
                        numeric: true
                    }
                )
        );
}


/*
 * ============================================================
 * VALIDATE SOURCE LESSON
 * ============================================================
 *
 * Make sure every lesson file is valid JSON
 * before encrypting it.
 */

function validateSourceJSON(
    filename,
    text
) {

    let data;

    try {

        data =
            JSON.parse(
                text
            );

    } catch (error) {

        throw new Error(
            `Invalid JSON in ${filename}: ${error.message}`
        );
    }


    if (
        !data ||
        typeof data !== "object" ||
        Array.isArray(data)
    ) {
        throw new Error(
            `${filename} does not contain a valid lesson object.`
        );
    }


    /*
     * Validate the day identity when present.
     */

    const match =
        /^day-(\d{3})\.json$/i.exec(
            filename
        );


    if (match) {

        const expectedDay =
            Number(
                match[1]
            );


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


/*
 * ============================================================
 * PROTECT ONE LESSON
 * ============================================================
 */

function protectLesson(
    sourceFile,
    outputFile,
    key
) {

    const sourcePath =
        path.join(
            SOURCE_DIR,
            sourceFile
        );


    const outputPath =
        path.join(
            OUTPUT_DIR,
            outputFile
        );


    /*
     * Read source JSON as UTF-8.
     */

    const sourceText =
        fs.readFileSync(
            sourcePath,
            "utf8"
        );


    /*
     * Validate JSON before encryption.
     */

    validateSourceJSON(
        sourceFile,
        sourceText
    );


    /*
     * Compress JSON.
     *
     * Maximum gzip compression is used because
     * lesson files are read-only deployment assets.
     */

    const compressed =
        zlib.gzipSync(
            Buffer.from(
                sourceText,
                "utf8"
            ),
            {
                level: 9
            }
        );


    /*
     * Generate a fresh random IV for every lesson.
     */

    const iv =
        crypto.randomBytes(
            IV_LENGTH
        );


    /*
     * Create AES-256-GCM cipher.
     */

    const cipher =
        crypto.createCipheriv(
            ALGORITHM,
            key,
            iv
        );


    /*
     * Encrypt compressed payload.
     */

    const encrypted =
        Buffer.concat([
            cipher.update(
                compressed
            ),
            cipher.final()
        ]);


    /*
     * Authentication tag protects the encrypted
     * data from tampering.
     */

    const authTag =
        cipher.getAuthTag();


    if (
        authTag.length !==
        AUTH_TAG_LENGTH
    ) {
        throw new Error(
            `Unexpected authentication tag length for ${sourceFile}.`
        );
    }


    /*
     * Final binary format:
     *
     * [ IV ][ AUTH TAG ][ ENCRYPTED DATA ]
     */

    const protectedData =
        Buffer.concat([
            iv,
            authTag,
            encrypted
        ]);


    /*
     * Write protected .dat file.
     */

    fs.writeFileSync(
        outputPath,
        protectedData
    );


    return {
        sourceBytes:
            Buffer.byteLength(
                sourceText,
                "utf8"
            ),

        compressedBytes:
            compressed.length,

        protectedBytes:
            protectedData.length
    };
}


/*
 * ============================================================
 * MAIN
 * ============================================================
 */

function main() {

    console.log("");
    console.log(
        "============================================================"
    );
    console.log(
        " VIDHWAAN NEET — PROTECTING LESSON DATA"
    );
    console.log(
        "============================================================"
    );
    console.log("");


    /*
     * Get and validate encryption key.
     */

    const key =
        getEncryptionKey();


    console.log(
        "Encryption: AES-256-GCM"
    );

    console.log(
        "Compression: gzip level 9"
    );

    console.log(
        "Key: valid 256-bit Base64 key"
    );

    console.log("");


    /*
     * Find source lesson files.
     */

    const sourceFiles =
        getSourceLessonFiles();


    if (
        sourceFiles.length === 0
    ) {
        throw new Error(
            "No public/data/day-*.json lesson files were found."
        );
    }


    console.log(
        `Source lesson files: ${sourceFiles.length}`
    );

    console.log("");


    /*
     * Recreate output directory.
     *
     * This guarantees stale .dat files from a
     * previous build cannot remain.
     */

    fs.rmSync(
        OUTPUT_DIR,
        {
            recursive: true,
            force: true
        }
    );


    fs.mkdirSync(
        OUTPUT_DIR,
        {
            recursive: true
        }
    );


    /*
     * Protect every lesson.
     */

    let totalSourceBytes = 0;
    let totalCompressedBytes = 0;
    let totalProtectedBytes = 0;


    for (
        const sourceFile of sourceFiles
    ) {

        const outputFile =
            sourceFile.replace(
                /\.json$/i,
                ".dat"
            );


        const result =
            protectLesson(
                sourceFile,
                outputFile,
                key
            );


        totalSourceBytes +=
            result.sourceBytes;

        totalCompressedBytes +=
            result.compressedBytes;

        totalProtectedBytes +=
            result.protectedBytes;


        console.log(
            `Protected: ${sourceFile} → ${outputFile}`
        );
    }


    /*
     * ========================================================
     * FINAL OUTPUT VERIFICATION
     * ========================================================
     */

    const outputFiles =
        fs.readdirSync(
            OUTPUT_DIR,
            {
                withFileTypes: true
            }
        )
        .filter(entry =>
            entry.isFile()
        )
        .map(entry =>
            entry.name
        )
        .sort(
            (a, b) =>
                a.localeCompare(
                    b,
                    undefined,
                    {
                        numeric: true
                    }
                )
        );


    const datFiles =
        outputFiles.filter(
            file =>
                /^day-\d{3}\.dat$/i.test(
                    file
                )
        );


    const jsonFiles =
        outputFiles.filter(
            file =>
                /\.json$/i.test(
                    file
                )
        );


    /*
     * Every source lesson must have exactly
     * one protected output file.
     */

    if (
        datFiles.length !==
        sourceFiles.length
    ) {
        throw new Error(
            `Protected file count mismatch. Source=${sourceFiles.length}, DAT=${datFiles.length}.`
        );
    }


    /*
     * There must be ZERO JSON lesson files
     * inside dist/data.
     */

    if (
        jsonFiles.length > 0
    ) {
        throw new Error(
            `Plain JSON lesson files remain in dist/data: ${jsonFiles.join(", ")}`
        );
    }


    /*
     * Make sure every expected output exists.
     */

    for (
        const sourceFile of sourceFiles
    ) {

        const expectedOutput =
            sourceFile.replace(
                /\.json$/i,
                ".dat"
            );


        if (
            !datFiles.includes(
                expectedOutput
            )
        ) {
            throw new Error(
                `Missing protected output: ${expectedOutput}`
            );
        }
    }


    /*
     * ========================================================
     * SUMMARY
     * ========================================================
     */

    console.log("");

    console.log(
        "============================================================"
    );

    console.log(
        " VIDHWAAN NEET — PROTECTION COMPLETE"
    );

    console.log(
        "============================================================"
    );

    console.log(
        `Lessons protected : ${datFiles.length}`
    );

    console.log(
        `Source size       : ${totalSourceBytes} bytes`
    );

    console.log(
        `Gzip size         : ${totalCompressedBytes} bytes`
    );

    console.log(
        `Protected size    : ${totalProtectedBytes} bytes`
    );

    console.log(
        `Output directory  : ${OUTPUT_DIR}`
    );

    console.log("");

    console.log(
        "Verified:"
    );

    console.log(
        "  ✓ AES-256-GCM encryption"
    );

    console.log(
        "  ✓ gzip compression"
    );

    console.log(
        "  ✓ Every lesson has a .dat output"
    );

    console.log(
        "  ✓ No plain lesson JSON in dist/data"
    );

    console.log("");

    console.log(
        "PROTECTION: PASSED"
    );

    console.log("");
}


/*
 * ============================================================
 * EXECUTE
 * ============================================================
 */

try {

    main();

} catch (error) {

    console.error("");
    console.error(
        "PROTECTION: FAILED"
    );
    console.error("");
    console.error(
        error.message
    );
    console.error("");

    process.exit(
        1
    );
}
