import { Plugin, TFile, TAbstractFile, Editor, MarkdownView } from 'obsidian';

export default class AutoIndexPlugin extends Plugin {
	private timeoutId: NodeJS.Timeout | null = null;

	async onload() {
		console.log('Loading Auto Index Plugin');
		
		try {
			// Listen for editor changes
			this.registerEvent(
				this.app.workspace.on('editor-change', (editor: Editor) => {
					const view = this.app.workspace.getActiveViewOfType(MarkdownView);
					if (!view) return;

					if (this.timeoutId) {
						clearTimeout(this.timeoutId);
					}

					// Wait for a short delay after typing stops
					this.timeoutId = setTimeout(async () => {
						const activeFile = this.app.workspace.getActiveFile();
						if (activeFile) {
							// Get the file's metadata to check for tags
							const metadata = this.app.metadataCache.getFileCache(activeFile);
							if (metadata?.tags) {
								await this.handleFileChange(activeFile);
							}
						}
					}, 2000); // Increased delay to ensure tag is complete
				})
			);

			// Keep file creation listener for when files are created through other means
			this.registerEvent(
				this.app.vault.on('create', async (file: TAbstractFile) => {
					if (file instanceof TFile && file.extension === 'md') {
						await this.handleFileChange(file);
					}
				})
			);
		} catch (error) {
			console.error('Error loading Auto Index Plugin:', error);
		}
	}

	async handleFileChange(file: TFile) {
		const metadata = this.app.metadataCache.getFileCache(file);
		const existingParents = await this.findExistingParentNotes(file);
		
		// Remove from all existing parent notes first
		for (const parentPath of existingParents) {
			const parentFile = this.app.vault.getAbstractFileByPath(parentPath);
			if (parentFile instanceof TFile) {
				await this.removeFromParentNote(parentFile, file);
			}
		}

		// If no tags, we're done after removing from parents
		if (!metadata?.tags) return;

		// Get current tags and create/update parent notes
		const currentParentTags = metadata.tags
			.map(tag => `${tag.tag.replace('#', '')}.md`);

		for (const parentPath of currentParentTags) {
			let parentFile = this.app.vault.getAbstractFileByPath(parentPath);
			
			// Create parent file if it doesn't exist
			if (!(parentFile instanceof TFile)) {
				parentFile = await this.createParentNote(parentPath);
				if (!(parentFile instanceof TFile)) continue;
			}
			
			await this.updateParentNote(parentFile, file);
		}
	}

	async createParentNote(parentPath: string): Promise<TFile> {
		// Create parent note with no content
		return await this.app.vault.create(parentPath, '');
	}

	async updateParentNote(parentFile: TFile, childFile: TFile) {
		const parentContent = await this.app.vault.read(parentFile);
		const childLink = `- [[${childFile.basename}]]`;

		// If link already exists, don't add it again
		if (parentContent.includes(childLink)) return;

		// Get existing links and add the new one
		const existingLinks = parentContent
			.split('\n')
			.filter(line => line.trim().startsWith('- [['))
			.concat([childLink])
			.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

		// Join links with newlines
		const newContent = existingLinks.join('\n');
		
		await this.app.vault.modify(parentFile, newContent);
	}

	async removeFromParentNote(parentFile: TFile, childFile: TFile) {
		const parentContent = await this.app.vault.read(parentFile);
		const childLink = `- [[${childFile.basename}]]`;
		
		// Remove the link and clean up
		const lines = parentContent.split('\n');
		const newLines = lines.filter(line => line.trim() !== childLink);
		
		// Only keep title and remaining links
		const newContent = newLines.join('\n').trim();
		
		// If content changed, update the file
		if (parentContent !== newContent) {
			await this.app.vault.modify(parentFile, newContent);
		}
	}

	async findExistingParentNotes(file: TFile): Promise<string[]> {
		const parents: string[] = [];
		const files = this.app.vault.getMarkdownFiles();
		
		for (const potentialParent of files) {
			const content = await this.app.vault.read(potentialParent);
			if (content.includes(`[[${file.basename}]]`)) {
				parents.push(potentialParent.path);
			}
		}
		
		return parents;
	}
}
