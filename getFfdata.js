import { spawn } from "node:child_process";
const ffprobe = "ffmpeg_macos_arm/ffprobe";

export async function getFfdata(filepath) {
  return new Promise((resolve, reject) => {
    try {
      const childProcess = spawn(ffprobe, [
        "-output_format",
        "json",
        "-show_format",
        "-show_streams",
        filepath,
      ]);

      let outputData = "";
      let errorData = "";

      childProcess.stdout.on("data", (data) => {
        outputData += data;
      });

      childProcess.stderr.on("data", (data) => {
        errorData += data;
      });

      childProcess.on("close", (code) => {
        if (code === 0) {
          try {
            const parsedMetadata = parseFfprobeOutput(outputData);
            resolve(parsedMetadata);
          } catch (parseError) {
            reject(
              new Error(`Failed to parse FFprobe output: ${parseError.message}`)
            );
          }
        } else {
          reject(new Error(`FFprobe failed with code ${code}: ${errorData}`));
        }
      });

      // Handle process errors
      childProcess.on("error", (err) => {
        reject(new Error(`Failed to start FFprobe: ${err.message}`));
      });
    } catch (error) {
      reject(new Error(`FFprobe exception: ${error.message}`));
    }
  });
}

export function parseFfprobeOutput(outputData) {
  const ffdata = JSON.parse(outputData);
  // Check if format.tags exists before trying to access comment
  if (!ffdata.format.tags || !ffdata.format.tags.comment) {
    return ffdata;
  }
  // First parse the comments:
  const parsedComments = {};
  const comments = ffdata?.format?.tags?.comment;
  const splitComments = comments.split(/\r\n/);
  splitComments.forEach((line) => {
    const [key, val] = line.split("=");
    if (key) parsedComments[key] = val;
  });

  // Then parse the coding history
  const codingHistoryObj = {};
  const codingHistory = ffdata?.format?.tags?.coding_history || "";
  if (codingHistory) {
    const codingHistoryArr = codingHistory.split(/,|;|\\/);
    codingHistoryArr.forEach((item) => {
      let [key, val] = item.split("=");
      val = val.replace(/\\r\\n/, "");
      codingHistoryObj[key] = val;
    });
    ffdata.format.tags.coding_history = codingHistoryObj;
  }
  const obj = {
    ...ffdata,
    format: { ...ffdata.format, ...parsedComments },
  };
  obj.format.tags.comment = "";
  return obj;
}
