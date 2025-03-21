#!/usr/bin/env node
import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import { getFfdata } from "./getFfdata.js";

const ffmpeg = "ffmpeg_macos_arm/ffmpeg";
const args = process.argv.slice(2);

async function main() {
  const getArgValue = (flag) => {
    const index = args.indexOf(flag);
    if (index === -1 || index + 1 >= args.length) return null;

    // Collect everything after the flag until the next flag
    const valueParts = [];
    for (let i = index + 1; i < args.length; i++) {
      if (args[i].startsWith("-")) break;
      valueParts.push(args[i]);
    }

    return valueParts.join(" "); // Reconstruct the full path
  };

  let inputDir = getArgValue("-i");
  let outputDir = getArgValue("-o");

  if (!inputDir) {
    inputDir = "inputFiles";
  }
  if (!outputDir) {
    outputDir = "outputFiles";
  }

  console.log(`Using input directory: ${inputDir}`);
  console.log(`Using output directory: ${outputDir}`);

  // Ensure input directory exists
  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory "${inputDir}" does not exist.`);
    process.exit(1);
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`Created output directory: ${outputDir}`);
  }

  const files = fs.readdirSync(inputDir);
  // Log all the files:
  console.log("==================");
  console.log(`All files found:`);
  files.forEach((file) => console.log("+", file));

  // Filter WAV files larger than 4GB
  const largeFiles = [];
  const smallFiles = [];

  files.forEach(async (file) => {
    const filePath = path.join(inputDir, file);
    const extension = path.parse(file).ext;
    if (fs.statSync(filePath).isDirectory() || extension !== ".wav")
      return false;
    if (fs.statSync(filePath).size >= 3840000172) {
      largeFiles.push(file);
    } else {
      try {
        const filePath = path.join(inputDir, file);
        const outputFilepath = path.join(outputDir, file);
        smallFiles.push(file);
        fs.copyFileSync(filePath, outputFilepath);
      } catch (e) {
        console.log(`Error while copying file: ${file}: ${e}`);
      }
    }
  });

  console.log(`Found ${largeFiles.length} large files to process.`);
  console.log(`Copying ${smallFiles.length} without processing`);
  const promises = [];

  // Process each large file
  for (const file of largeFiles) {
    promises.push(
      new Promise(async (resolve, reject) => {
        const filePath = path.join(inputDir, file);
        const inputPath = path.join(inputDir, file);
        const fileBaseName = path.parse(file).name;
        const fileExtension = path.parse(file).ext;
        const fileData = await getFfdata(filePath);
        console.log(fileData);

        console.log(`Processing: ${file}`);
        console.log(fileData);

        try {
          const duration = parseFloat(fileData.streams[0].duration);
          const maxDuration = 21000;
          const numOfSegments = Math.ceil(duration / maxDuration);

          console.log(`File duration: ${duration} sec`);
          console.log(`Max segment duration: ${maxDuration} sec`);
          console.log(`Estimated number of segments: ${numOfSegments}`);

          // Split file into segments
          let currentTimecode = parseInt(
            fileData.format.tags.time_reference || 0
          );
          console.log(
            `Starting with original time_reference: ${currentTimecode}`
          );

          for (let i = 0; i < numOfSegments; i++) {
            const startTime = i * maxDuration;
            const endTime =
              i === numOfSegments - 1 ? duration : startTime + maxDuration;
            const segmentNum = i + 1;
            const outputFileName = `${fileBaseName}_${segmentNum}${fileExtension}`;
            const outputPath = path.join(outputDir, outputFileName);

            // For the first segment, use the original timecode
            // For subsequent segments, add the segment duration in samples
            if (i > 0) {
              const sampleRate = 48000;
              const segmentDurationInSamples = Math.round(
                maxDuration * sampleRate
              );
              currentTimecode += segmentDurationInSamples;

              // Handle wrapping around at 24 hours (86400 seconds * sample rate)
              const samplesPerDay = 4147200000;
              if (currentTimecode >= samplesPerDay) {
                currentTimecode = currentTimecode % samplesPerDay;
                console.log("WARNING: Time reference wrapped around 24 hours!");
              }
            }

            // Log current timecode in human-readable format
            const sampleRate = 48000;
            const totalSeconds = Math.floor(currentTimecode / sampleRate);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;

            console.log(
              `Segment ${segmentNum} timecode: ${hours
                .toString()
                .padStart(2, "0")}:${minutes
                .toString()
                .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`
            );

            // const a20Comment = `sSPEED=${fileData.format.sSPEED}\n\rsTRK1=${fileData.format.sTRK1}`;

            console.log(`Creating segment ${segmentNum}: ${outputFileName}`);

            const command = [
              ffmpeg,
              "-ss",
              startTime.toString(),
              "-to",
              endTime,
              "-i",
              `"${inputPath}"`,
              "-c",
              "copy",
              "-map_metadata",
              "0",
              "-metadata",
              `time_reference=${currentTimecode}`,
              "-metadata",
              `encoded_by="${fileData.format.sTRK1}"`,
              "-metadata",
              `sSPEED="${fileData.format.sSPEED}"`,
              "-write_bext",
              "1",
              "-y",
              `"${outputPath}"`,
            ].join(" ");

            console.log(`Executing: ${command}`);

            execSync(command, { stdio: "inherit", shell: true });
          }
          console.log(`Split ${file}`);
          resolve();
        } catch (error) {
          console.error(`Error processing ${file}:`, error.message);
          reject();
        }
      })
    );
  }
  return await Promise.all(promises)
    .then(() => {
      console.log("All files processed.");
      return;
    })
    .catch((e) => {
      console.log(e);
    });
}

main().catch((error) => {
  console.error("ERROR IN MAIN PROCESS", error);
  process.exit(1);
});
