import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── TSX Code Extractor ───
function extractTsxBlocks(text) {
    const blocks = [];
    const mdRegex = /```(tsx|typescript|jsx|javascript)\n([\s\S]*?)```/g;
    let match;
    while ((match = mdRegex.exec(text)) !== null) {
        blocks.push({
            id: `block-${blocks.length + 1}`,
            type: match[1] === 'typescript' ? 'ts' : match[1],
            code: match[2].trim()
        });
    }
    if (blocks.length === 0) {
        if (text.includes('import') || (text.includes('<') && text.includes('/>'))) {
            blocks.push({ id: 'auto-1', type: 'tsx', code: text.trim() });
        }
    }
    return blocks;
}

// ─── Parse duration from TSX code ───
function parseDuration(code) {
    // Look for compositionConfig or durationInSeconds
    const durationMatch = code.match(/durationInSeconds\s*[:=]\s*(\d+)/);
    const fpsMatch = code.match(/fps\s*[:=]\s*(\d+)/);

    const durationSec = durationMatch ? parseInt(durationMatch[1]) : 5; // default 5s
    const fps = fpsMatch ? parseInt(fpsMatch[1]) : 30;

    console.log(`   📐 Parsed: ${durationSec}s @ ${fps}fps = ${durationSec * fps} frames`);
    return { durationSec, fps };
}

// ─── Parse resolution from TSX code ───
function parseResolution(code) {
    const widthMatch = code.match(/width\s*[:=]\s*(\d{3,4})/);
    const heightMatch = code.match(/height\s*[:=]\s*(\d{3,4})/);

    const width = widthMatch ? parseInt(widthMatch[1]) : 1920;
    const height = heightMatch ? parseInt(heightMatch[1]) : 1080;

    return { width, height };
}

// ─── Main Automation ───
(async () => {
    const inputFile = path.join(__dirname, 'input.txt');
    if (!fs.existsSync(inputFile)) {
        console.error('❌ automation/input.txt not found!');
        process.exit(1);
    }

    const inputText = fs.readFileSync(inputFile, 'utf-8');
    const blocks = extractTsxBlocks(inputText);

    if (blocks.length === 0) {
        console.error('❌ No TSX code blocks found in input.txt');
        process.exit(1);
    }

    console.log(`✅ Found ${blocks.length} TSX code block(s). Starting automation...\n`);

    const downloadsDir = path.join(__dirname, '..', 'downloads');
    if (!fs.existsSync(downloadsDir)) {
        fs.mkdirSync(downloadsDir, { recursive: true });
    }

    // Parse resolution from first block (most common case)
    const resolution = parseResolution(blocks[0].code);
    console.log(`🖥️  Target resolution: ${resolution.width}x${resolution.height}\n`);

    const browser = await chromium.launch({
        headless: false,
        args: [
            '--use-fake-ui-for-media-stream',
            '--enable-usermedia-screen-capturing',
            '--auto-select-desktop-capture-source=kuTSX',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-gpu',
            `--window-size=${resolution.width},${resolution.height}`,
        ]
    });

    const context = await browser.newContext({
        viewport: { width: resolution.width, height: resolution.height },
        permissions: ['clipboard-read', 'clipboard-write'],
        deviceScaleFactor: 1,
    });

    context.grantPermissions(['camera', 'microphone']);
    const page = await context.newPage();

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const videoName = `video_${i + 1}`;
        const { durationSec } = parseDuration(block.code);

        console.log(`\n🎬 [${i + 1}/${blocks.length}] Processing: ${videoName} (${durationSec}s)`);

        try {
            // Step 1: Navigate to the site
            await page.goto('https://kux-three.vercel.app/', { waitUntil: 'networkidle' });
            await page.waitForTimeout(2000);

            // Step 2: Paste TSX code into the editor
            const editorSelector = 'textarea[placeholder*="Paste Remotion TSX code here"]';
            await page.waitForSelector(editorSelector, { timeout: 15000 });
            await page.focus(editorSelector);
            await page.keyboard.press('Control+A');
            await page.keyboard.press('Backspace');
            await page.fill(editorSelector, block.code);
            console.log('   ✅ Code pasted');

            // Step 3: Wait for preview to fully render
            console.log('   ⏳ Waiting 2 seconds for preview...');
            await page.waitForTimeout(2000);

            // Step 4: Click "Download 4K" button
            const downloadBtnSelector = 'button:has-text("Download 4K")';
            await page.waitForSelector(downloadBtnSelector, { timeout: 10000 });

            // Setup download listener BEFORE clicking
            const downloadPromise = page.waitForEvent('download', {
                timeout: (durationSec + 60) * 1000 // duration + 60s buffer
            });

            await page.click(downloadBtnSelector);
            console.log('   ✅ Download 4K clicked');

            // Step 5: Wait for screen share permission (handled by chrome flags)
            await page.waitForTimeout(2000);

            // Step 6: Check if recording started
            const stopBtnSelector = 'button:has-text("Stop"), button:has-text("Save")';
            try {
                await page.waitForSelector(stopBtnSelector, { timeout: 15000 });
                console.log('   ✅ Recording started!');
            } catch {
                console.log('   ⚠️  Recording may not have started properly');
            }

            // Step 7: Wait for the full duration + buffer
            const waitTime = (durationSec + 5) * 1000;
            console.log(`   ⏳ Waiting ${durationSec + 5}s for recording to complete...`);

            // Step 8: Wait for download
            try {
                const download = await downloadPromise;
                const downloadPath = path.join(downloadsDir, `${videoName}.mp4`);
                await download.saveAs(downloadPath);

                const stats = fs.statSync(downloadPath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                console.log(`   ✅ Video saved: ${videoName}.mp4 (${sizeMB} MB)`);
            } catch (dlErr) {
                console.log('   ⚠️  Auto-download timeout. Trying manual stop...');

                // Try clicking stop button
                try {
                    const stopBtn = await page.$(stopBtnSelector);
                    if (stopBtn) {
                        const manualDownload = page.waitForEvent('download', { timeout: 30000 });
                        await stopBtn.click();
                        const download = await manualDownload;
                        const downloadPath = path.join(downloadsDir, `${videoName}.mp4`);
                        await download.saveAs(downloadPath);

                        const stats = fs.statSync(downloadPath);
                        const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                        console.log(`   ✅ Video saved (manual): ${videoName}.mp4 (${sizeMB} MB)`);
                    }
                } catch {
                    console.log('   ❌ Could not save video for this block.');
                }
            }

        } catch (err) {
            console.error(`   ❌ Error: ${err.message}`);
        }
    }

    await browser.close();

    const savedFiles = fs.readdirSync(downloadsDir).filter(f => f.endsWith('.mp4'));
    console.log(`\n\n🎉 Automation complete! ${savedFiles.length}/${blocks.length} videos saved.`);

    if (savedFiles.length > 0) {
        console.log('📁 Videos:');
        savedFiles.forEach(f => {
            const stats = fs.statSync(path.join(downloadsDir, f));
            console.log(`   ${f} — ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
        });
    }
})();
