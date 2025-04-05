// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
const vscode = require("vscode");
const { Groq } = require("groq-sdk");

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
  // Use the console to output diagnostic information (console.log) and errors (console.error)
  // This line of code will only be executed once when your extension is activated
  console.log('Congratulations, your extension "navbuddy" is now active!');

  // Variable to store selected directories for the session
  let selectedDirectories = [];

  // Try to load previously saved directories from global state
  const savedDirectories = context.globalState.get(
    "navbuddy.selectedDirectories"
  );
  if (savedDirectories && Array.isArray(savedDirectories)) {
    selectedDirectories = savedDirectories;
  }

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  const saveapi = vscode.commands.registerCommand(
    "navbuddy.addApiKey",
    async function () {
      // The code you place here will be executed every time your command is executed
      // read the api key from the user

      const apiKey = await vscode.window.showInputBox({
        prompt: "Enter your NavBuddy API Key",
        placeHolder: "API Key",
        password: true,
      });

      if (!apiKey) {
        vscode.window.showErrorMessage("API Key is required");
        return;
      }

      // Save the api key to the workspace configuration
      const config = vscode.workspace.getConfiguration("navbuddy");
      await config.update("apiKey", apiKey, vscode.ConfigurationTarget.Global);

      // Display a message box to the user AFTER the key is saved
      vscode.window.showInformationMessage(
        "NavBuddy API Key saved successfully!"
      );
    }
  );

  const activate = vscode.commands.registerCommand(
    "navbuddy.activate",
    async function () {
      // read the api key from the workspace configuration
      const config = vscode.workspace.getConfiguration("navbuddy");
      const apiKey = config.get("apiKey");
      if (!apiKey) {
        vscode.window.showErrorMessage("API Key is not set");
        return;
      }

      // Ask user to select folders and save them
      selectedDirectories = await selectFoldersToScan();

      // Save selected directories to global state for persistence
      await context.globalState.update(
        "navbuddy.selectedDirectories",
        selectedDirectories
      );

      if (selectedDirectories.length > 0) {
        vscode.window.showInformationMessage(
          `NavBuddy is activated! Selected ${selectedDirectories.length} folder(s) for scanning.`
        );
      } else {
        vscode.window.showInformationMessage(
          "NavBuddy is activated! No specific folders selected - will scan the entire workspace."
        );
      }
    }
  );

  // Add command to change selected directories
  const changeDirs = vscode.commands.registerCommand(
    "navbuddy.changeFolders",
    async function () {
      // Ask user to select folders and save them
      selectedDirectories = await selectFoldersToScan();

      // Save selected directories to global state for persistence
      await context.globalState.update(
        "navbuddy.selectedDirectories",
        selectedDirectories
      );

      if (selectedDirectories.length > 0) {
        vscode.window.showInformationMessage(
          `Selected ${selectedDirectories.length} folder(s) for scanning.`
        );
      } else {
        vscode.window.showInformationMessage(
          "No specific folders selected - will scan the entire workspace."
        );
      }
    }
  );

  // Add this function to select folders
  async function selectFoldersToScan() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      vscode.window.showErrorMessage("No workspace folder is open");
      return [];
    }

    // Get all folders in the workspace
    const baseFolder = workspaceFolders[0];
    const pattern = new vscode.RelativePattern(baseFolder, "**");

    try {
      const folderUris = await vscode.workspace.findFiles(
        pattern,
        "**/node_modules/**",
        1000
      );

      // Filter to only include directories
      const dirPaths = new Set();

      for (const uri of folderUris) {
        const relativePath = vscode.workspace.asRelativePath(uri);
        const dirPath = relativePath.substring(
          0,
          relativePath.lastIndexOf("/")
        );
        if (dirPath) {
          dirPaths.add(dirPath);
        }
      }

      // Add the root folder
      dirPaths.add("");

      // Convert to array and sort
      const sortedDirs = Array.from(dirPaths).sort();

      // Show quick pick with checkboxes to select folders
      const selectedDirs = await vscode.window.showQuickPick(
        sortedDirs.map((dir) => ({
          label: dir || "/ (root)",
          picked: false,
        })),
        {
          canPickMany: true,
          placeHolder:
            "Select folders to scan for comments (leave empty for all)",
          title: "NavBuddy: Select Folders to Scan",
        }
      );

      return (
        selectedDirs?.map((item) =>
          item.label === "/ (root)" ? "" : item.label
        ) || []
      );
    } catch (error) {
      console.error("Error finding folders:", error);
      vscode.window.showErrorMessage("Error finding folders: " + error.message);
      return [];
    }
  }

  // Add this function somewhere in your activate function
  function createFileLinks(responseText, baseFolder) {
    // Use regex to find file paths in the response
    // This pattern looks for file paths mentioned with specific formats:
    // - src/file.js:10
    // - src/file.js (line 10)
    // - `src/file.js`
    const filePathRegex =
      /(?:`([^`]+\.[a-zA-Z0-9]+)`)|(?:(\S+\.[a-zA-Z0-9]+)(?::(\d+)|\s*\(line\s*(\d+)\)))/g;

    let match;
    let linkedText = responseText;
    const links = [];

    while ((match = filePathRegex.exec(responseText)) !== null) {
      // Extract the file path and line number from the match
      let filePath = match[1] || match[2];
      // Parse line number as integer but convert back to string for URL
      let lineNumber = match[3] || match[4] || "1"; // Default to line 1 if not specified

      // Parse as integer for internal use
      const lineNumberInt = parseInt(lineNumber, 10);

      // Only process if we have a valid file path
      if (filePath) {
        // Clean up the file path (remove surrounding backticks if present)
        filePath = filePath.trim();

        // Create a unique ID for this link
        const linkId = `navbuddy-link-${links.length}`;

        // Add to our links collection - use the integer version of lineNumber
        links.push({ id: linkId, filePath, lineNumber: lineNumberInt });

        // Replace the text with a markdown link that includes data attributes
        // Use string for the display text, but pass the integer in the command args
        const originalMatch = match[0];
        const linkText = `[${filePath}:${lineNumber}](command:navbuddy.openFile?${encodeURIComponent(
          JSON.stringify({ filePath, lineNumber: lineNumberInt })
        )})`;

        // Replace in the text, but we need to escape regex special chars in the original match
        const escapedMatch = originalMatch.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );
        linkedText = linkedText.replace(
          new RegExp(escapedMatch, "g"),
          linkText
        );
      }
    }

    return linkedText;
  }

  // Add this helper function to find line numbers for comments
  function findLineNumberForComment(fileText, comment) {
    const lines = fileText.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(comment.trim())) {
        return i + 1; // Convert to 1-based line number
      }
    }
    return 1; // Default to line 1 if not found
  }

  // Update the findCode command to make it more seamless

  const findCode = vscode.commands.registerCommand(
    "navbuddy.findCode",
    async function () {
      try {
        // Get the API key first
        const config = vscode.workspace.getConfiguration("navbuddy");
        const apiKey = config.get("apiKey");
        if (!apiKey) {
          vscode.window.showErrorMessage("API Key is not set");
          return;
        }

        // Use the already selected folders (no need to ask again)
        // If no folders were previously selected, confirm with user
        let foldersToScan = selectedDirectories;

        if (foldersToScan.length === 0) {
          const continueAnyway = await vscode.window.showWarningMessage(
            "No folders were previously selected. Do you want to scan the entire workspace?",
            "Yes",
            "Select Folders",
            "Cancel"
          );

          if (continueAnyway === "Select Folders") {
            foldersToScan = await selectFoldersToScan();
            // Save these for future use
            selectedDirectories = foldersToScan;
            await context.globalState.update(
              "navbuddy.selectedDirectories",
              selectedDirectories
            );
          } else if (continueAnyway !== "Yes") {
            return;
          }
        }

        // Now read the prompt
        const prompt = await vscode.window.showInputBox({
          prompt: "Enter your prompt",
          placeHolder: "prompt",
          password: false,
        });

        if (!prompt) {
          return; // Simply return without error message
        }

        // Show a toast notification instead of opening an editor
        const progressToast = vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "NavBuddy",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Scanning files for comments..." });

            // get all comment strings from selected folders - without notification
            const commentStrings = [];
            // Improved regex for more accurate comment detection including JSX comments
            const commentRegex =
              /(?:\/\/[^\r\n]*)|(?:\/\*[\s\S]*?\*\/)|(?:\{\/\*[\s\S]*?\*\/\})/g;
            const workspaceFolders = vscode.workspace.workspaceFolders;

            if (!workspaceFolders) {
              vscode.window.showErrorMessage("No workspace folder is open");
              return;
            }

            const baseFolder = workspaceFolders[0];

            // Build include patterns based on selected folders
            let includePatterns = [];
            if (foldersToScan.length > 0) {
              // Create individual patterns for each selected folder
              includePatterns = foldersToScan.map((folder) => {
                if (folder) {
                  return new vscode.RelativePattern(
                    baseFolder,
                    `${folder}/**/*.{js,ts,jsx,tsx}`
                  );
                } else {
                  return new vscode.RelativePattern(
                    baseFolder,
                    "*.{js,ts,jsx,tsx}"
                  );
                }
              });
            } else {
              // If no folders are selected, search everywhere
              includePatterns.push(
                new vscode.RelativePattern(baseFolder, "**/*.{js,ts,jsx,tsx}")
              );
            }

            // Find all files across all patterns
            const files = [];
            for (const pattern of includePatterns) {
              const patternFiles = await vscode.workspace.findFiles(
                pattern,
                "**/node_modules/**"
              );
              files.push(...patternFiles);
            }

            if (files.length === 0) {
              vscode.window.showInformationMessage(
                "No files found in the selected folders"
              );
              return;
            }

            // Process files in batches to avoid overwhelming the system
            const batchSize = 20;
            let processedFiles = 0;
            let commentCount = 0;

            progress.report({
              message: `Scanning files for comments (0/${files.length})...`,
            });

            for (let i = 0; i < files.length; i += batchSize) {
              const batch = files.slice(i, i + batchSize);

              // Update progress periodically
              if (i % (batchSize * 5) === 0) {
                progress.report({
                  message: `Scanning files for comments (${processedFiles}/${files.length})...`,
                });
              }

              await Promise.all(
                batch.map(async (fileUri) => {
                  try {
                    const doc = await vscode.workspace.openTextDocument(
                      fileUri
                    );
                    const text = doc.getText();
                    const matches = text.match(commentRegex);

                    // Modify the comment collection to capture line numbers
                    if (matches) {
                      // Add file path context to each comment
                      const relativePath =
                        vscode.workspace.asRelativePath(fileUri);

                      // Process and clean up each comment - filter out false positives
                      const enrichedComments = matches
                        .filter((comment) => {
                          // Filter out cases where "//" is part of a URL or attribute
                          const isLikelyUrl =
                            comment.includes("http://") ||
                            comment.includes("https://") ||
                            comment.includes('"//"') ||
                            comment.includes("'//'");

                          // Also filter out things that look like HTML/JSX attributes
                          const isLikelyAttribute =
                            comment.includes("target=") ||
                            comment.includes("href=") ||
                            comment.match(/\w+=""/) ||
                            comment.match(/\w+=''/);

                          // Special case for JSX comments that contain HTML-like elements
                          const isJsxComment =
                            comment.startsWith("{/*") &&
                            comment.endsWith("*/}");

                          // If it's a JSX comment, we want to keep it despite other signals
                          if (isJsxComment) {
                            // But still filter out comments that are clearly just HTML elements
                            const isJustHtmlElement =
                              (comment.includes("<a ") ||
                                comment.includes("<div ") ||
                                comment.includes("<span ") ||
                                comment.includes("<img ")) &&
                              !comment.includes("todo") &&
                              !comment.includes("TODO") &&
                              !comment.includes("note") &&
                              !comment.includes("NOTE");

                            return !isJustHtmlElement;
                          }

                          // For non-JSX comments, use the URL/attribute filters
                          return !isLikelyUrl && !isLikelyAttribute;
                        })
                        .map((comment) => {
                          // Clean up any URLs in legitimate comments
                          let cleanedComment = comment.trim();

                          // Remove comment markers for cleaner results
                          cleanedComment = cleanedComment
                            .replace(/^\/\/\s*/, "") // Remove // at start
                            .replace(/^\/\*+\s*/, "") // Remove /* at start
                            .replace(/\s*\*+\/$/, "") // Remove */ at end
                            .replace(/^\{\s*\/\*+\s*/, "") // Remove {/* at start for JSX
                            .replace(/\s*\*+\/\s*\}$/, "") // Remove */} at end for JSX
                            .trim();

                          // Find the line number for this comment
                          const commentLineNumber = findLineNumberForComment(
                            text,
                            comment
                          );

                          return {
                            text: cleanedComment,
                            file: relativePath,
                            lineNumber: commentLineNumber, // Add line number info
                          };
                        });

                      commentStrings.push(...enrichedComments);
                      commentCount += enrichedComments.length;
                    }

                    processedFiles++;
                  } catch (error) {
                    console.error(
                      `Error processing file ${fileUri.fsPath}:`,
                      error
                    );
                  }
                })
              );
            }

            if (commentStrings.length === 0) {
              vscode.window.showInformationMessage(
                "No comments found in the selected folders"
              );
              return;
            }

            try {
              progress.report({ message: "Sending data to LLM..." });

              // Initialize Groq client with the API key
              const groq = new Groq({
                apiKey: apiKey,
              });

              // Update the system prompt to be extremely specific about format
              const systemPrompt =
                "You are NavBuddy, a code navigation assistant. Analyze code comments to find the SINGLE most relevant file for the query. " +
                "Reply with ONLY ONE line in this exact format: 'filepath:linenumber' (e.g., 'src/App.js:25'). " +
                "No explanation, no markdown, no additional text. Just one line with the file path and line number.";

              // Then modify the user prompt to include line numbers
              const userPrompt =
                `Find code for: "${prompt}". Code comments:\n` +
                commentStrings
                  .slice(0, 25) // Reduce to 25 comments to save tokens
                  .map((c) => {
                    // Include line number in each comment
                    const lineInfo = c.lineNumber ? `:${c.lineNumber}` : "";
                    return `${c.file}${lineInfo}: ${
                      c.text.length > 80
                        ? c.text.substring(0, 80) + "..."
                        : c.text
                    }`;
                  })
                  .join("\n");

              // 3. Update the parameters to reduce token usage
              const response = await groq.chat.completions.create({
                messages: [
                  {
                    role: "system",
                    content: systemPrompt,
                  },
                  {
                    role: "user",
                    content: userPrompt,
                  },
                ],
                model: "llama-3.3-70b-versatile",
                temperature: 0.3,
                max_tokens: 600, // Reduced from 1000 to save tokens
                top_p: 1,
                stream: false,
              });

              // Get the response text and clean it
              const responseText = response.choices[0].message.content.trim();

              // Log the response from the LLM
              console.log("--- LLM RESPONSE ---");
              console.log(responseText);
              console.log("-------------------");

              // Process the response to extract the file path and line number
              // The regex matches any text that might be around the filepath:linenumber format
              const filePathMatch = responseText.match(
                /([^`\s]+\.[a-zA-Z0-9]+):(\d+)/
              );

              if (filePathMatch) {
                const filePath = filePathMatch[1];
                const lineNumber = parseInt(filePathMatch[2], 10);

                // Log that we're opening a file
                console.log(`Opening file: ${filePath}:${lineNumber}`);
                progress.report({
                  message: `Opening file: ${filePath}:${lineNumber}`,
                });

                // Find the file in the workspace directly without showing any intermediate UI
                // Find the file directly
                let fileUris = [];

                // First try with exact path
                fileUris = await vscode.workspace.findFiles(
                  new vscode.RelativePattern(baseFolder, filePath),
                  null,
                  1
                );

                // If not found, try a broader search
                if (fileUris.length === 0) {
                  // Get the filename part
                  const fileName = filePath.split(/[\/\\]/).pop();
                  fileUris = await vscode.workspace.findFiles(
                    new vscode.RelativePattern(baseFolder, `**/${fileName}`),
                    null,
                    10
                  );

                  // If multiple matches found, use the first one
                  // We're optimizing for speed here, so we won't show a picker
                }

                if (fileUris.length === 0) {
                  vscode.window.showErrorMessage(`File not found: ${filePath}`);
                  return;
                }

                // Open the document
                const document = await vscode.workspace.openTextDocument(
                  fileUris[0]
                );
                const resultEditor = await vscode.window.showTextDocument(
                  document
                );

                // Go to the specified line
                if (lineNumber > 0) {
                  // Adjust for 0-based line numbers in VS Code API
                  const line = Math.min(lineNumber - 1, document.lineCount - 1);

                  // Get the range for the line
                  const lineText = document.lineAt(line);
                  const position = new vscode.Position(line, 0);

                  // Move cursor to the position and reveal it
                  resultEditor.selection = new vscode.Selection(
                    position,
                    position
                  );
                  resultEditor.revealRange(
                    new vscode.Range(position, position),
                    vscode.TextEditorRevealType.InCenter
                  );

                  // Highlight the line briefly
                  const decoration =
                    vscode.window.createTextEditorDecorationType({
                      backgroundColor: new vscode.ThemeColor(
                        "editor.findMatchHighlightBackground"
                      ),
                      isWholeLine: true,
                    });

                  resultEditor.setDecorations(decoration, [lineText.range]);

                  // Remove the decoration after a delay
                  setTimeout(() => {
                    decoration.dispose();
                  }, 2000);
                }
              } else {
                vscode.window.showErrorMessage(
                  "Could not find a valid file path in the LLM response. Try a different query."
                );
              }
            } catch (error) {
              console.error("Groq API request failed:", error);
              vscode.window.showErrorMessage(
                `Error contacting Groq API: ${error.message}`
              );
            }
          }
        );
      } catch (error) {
        console.error("Error in findCode command:", error);
        vscode.window.showErrorMessage("Error: " + error.message);
      }
    }
  );

  // Now register a command to open files at specific lines
  const openFileCommand = vscode.commands.registerCommand(
    "navbuddy.openFile",
    async (args) => {
      try {
        const { filePath, lineNumber } = args;

        // Find the file in the workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
          vscode.window.showErrorMessage("No workspace folder is open");
          return;
        }

        const baseFolder = workspaceFolders[0];

        // Try to find the file using the path
        let fileUris = [];

        // First try with exact path
        fileUris = await vscode.workspace.findFiles(
          new vscode.RelativePattern(baseFolder, filePath),
          null,
          1
        );

        // If not found, try a broader search
        if (fileUris.length === 0) {
          // Get the filename part
          const fileName = filePath.split(/[\/\\]/).pop();
          fileUris = await vscode.workspace.findFiles(
            new vscode.RelativePattern(baseFolder, `**/${fileName}`),
            null,
            10
          );

          // If multiple matches found, show a quick pick to let user choose
          if (fileUris.length > 1) {
            const items = fileUris.map((uri) => ({
              label: vscode.workspace.asRelativePath(uri),
              uri,
            }));

            const selected = await vscode.window.showQuickPick(items, {
              placeHolder: `Multiple files named "${fileName}" found. Please select one:`,
            });

            if (!selected) return;
            fileUris = [selected.uri];
          }
        }

        if (fileUris.length === 0) {
          vscode.window.showErrorMessage(`File not found: ${filePath}`);
          return;
        }

        // Open the document
        const document = await vscode.workspace.openTextDocument(fileUris[0]);
        const editor = await vscode.window.showTextDocument(document);

        // Go to the specified line
        if (lineNumber > 0) {
          // Adjust for 0-based line numbers in VS Code API
          const line = Math.min(lineNumber - 1, document.lineCount - 1);

          // Get the range for the line
          const lineText = document.lineAt(line);
          const position = new vscode.Position(line, 0);

          // Move cursor to the position and reveal it
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(
            new vscode.Range(position, position),
            vscode.TextEditorRevealType.InCenter
          );

          // Highlight the line briefly
          const decoration = vscode.window.createTextEditorDecorationType({
            backgroundColor: new vscode.ThemeColor(
              "editor.findMatchHighlightBackground"
            ),
            isWholeLine: true,
          });

          editor.setDecorations(decoration, [lineText.range]);

          // Remove the decoration after a delay
          setTimeout(() => {
            decoration.dispose();
          }, 2000);
        }
      } catch (error) {
        console.error("Error opening file:", error);
        vscode.window.showErrorMessage(`Error opening file: ${error.message}`);
      }
    }
  );

  // Register all commands
  context.subscriptions.push(
    saveapi,
    findCode,
    activate,
    changeDirs,
    openFileCommand
  );
}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
