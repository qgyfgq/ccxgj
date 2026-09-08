/**
 * =========================================================================
 * 1. IndexedDB 数据持久化存储引擎 (DBManager)
 * 保证数据在 iOS / iPad / Desktop 永久不丢失
 * =========================================================================
 */
class DBManager {
    constructor() {
        this.dbName = 'RainyNovelDB';
        this.version = 1;
        this.db = null;
    }

    // 初始化并建立 IndexedDB 存储库
    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = (e) => console.error('IndexedDB 打开失败:', e);
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };

            // 创建数据库表表结构
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                // 书籍表
                if (!db.objectStoreNames.contains('books')) {
                    db.createObjectStore('books', { keyPath: 'id' });
                }
                // 分类分组表
                if (!db.objectStoreNames.contains('categories')) {
                    db.createObjectStore('categories', { keyPath: 'id' });
                }
                // Char 人设表
                if (!db.objectStoreNames.contains('chars')) {
                    db.createObjectStore('chars', { keyPath: 'id' });
                }
                // User 人设表
                if (!db.objectStoreNames.contains('users')) {
                    db.createObjectStore('users', { keyPath: 'id' });
                }
                // 世界书表
                if (!db.objectStoreNames.contains('worldbooks')) {
                    db.createObjectStore('worldbooks', { keyPath: 'id' });
                }
                // API 预设表
                if (!db.objectStoreNames.contains('apiPresets')) {
                    db.createObjectStore('apiPresets', { keyPath: 'id' });
                }
                // 段落评论表
                if (!db.objectStoreNames.contains('comments')) {
                    db.createObjectStore('comments', { keyPath: 'id' });
                }
                // 全局系统配置表 (字体、壁纸、阅读偏好)
                if (!db.objectStoreNames.contains('settings')) {
                    db.createObjectStore('settings', { keyPath: 'key' });
                }
            };
        });
    }

    // 通用写入方法
    async saveItem(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.put(item);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e);
        });
    }

    // 通用查询全表方法
    async getAllItems(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e);
        });
    }

    // 通用主键查询
    async getItem(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const req = store.get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = (e) => reject(e);
        });
    }

    // 通用删除方法
    async deleteItem(storeName, key) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e);
        });
    }
}

// 实例化数据库单例
const dbManager = new DBManager();


/**
 * =========================================================================
 * 2. 高级解析器库 (Parsers)
 * 小说 TXT 智能分章 + 酒馆卡 (PNG/JSON/Docx/TXT) 人设解析器
 * =========================================================================
 */
const Parsers = {
    /**
     * 解析 TXT 文件并转换为章节结构
     * @param {string} textContent - 小说文本全文
     * @returns {Array} [{ title: "第1章 xxx", content: ["段落1", "段落2"] }]
     */
    parseTxtToChapters(textContent) {
        if (!textContent) return [];

        // 规范化换行符
        const cleanText = textContent.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        
        // 用于匹配章节标题的通用正则模式 (例: 第1章, 第一百二十卷, 序章, 楔子, Chapter 1 等)
        const chapterRegex = /(^\s*第[0-9一二三四五六七八九十百千万]+[章卷回节篇][^\n]*)|(^\s*(序章|楔子|前言|后记|番外)[^\n]*)/m;

        const lines = cleanText.split('\n');
        const chapters = [];
        let currentChapter = { title: '前言 / 开始', content: [] };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue; // 过滤多余空行

            // 判断是否为新章节标题
            if (chapterRegex.test(line) && line.length < 50) {
                if (currentChapter.content.length > 0) {
                    chapters.push(currentChapter);
                }
                currentChapter = { title: line, content: [] };
            } else {
                currentChapter.content.push(line);
            }
        }

        // 保存最后一章
        if (currentChapter.content.length > 0) {
            chapters.push(currentChapter);
        }

        // 如果没有成功拆分出章节，则按固定字数(如 5000 字)强制切分
        if (chapters.length === 1 && chapters[0].content.join('').length > 10000) {
            return this.fallbackSplitByLength(chapters[0].content);
        }

        return chapters;
    },

    // 备用强制切分逻辑
    fallbackSplitByLength(lines) {
        const result = [];
        let chunk = [];
        let count = 0;
        let index = 1;

        for (const line of lines) {
            chunk.push(line);
            count += line.length;
            if (count >= 4000) {
                result.push({ title: `第 ${index} 部分`, content: chunk });
                chunk = [];
                count = 0;
                index++;
            }
        }
        if (chunk.length > 0) {
            result.push({ title: `第 ${index} 部分`, content: chunk });
        }
        return result;
    },

    /**
     * 酒馆角色卡 PNG 解包器 (提取 PNG tEXt 块中的 base64 / chara JSON)
     * @param {File} file - 用户上传的 PNG 文件
     * @returns {Promise<Object>} { name, description, avatarBase64 }
     */
    async parseTavernPngCard(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsArrayBuffer(file);

            reader.onload = async (e) => {
                try {
                    const buffer = e.target.result;
                    const view = new DataView(buffer);
                    
                    // 验证 PNG 头魔数: 89 50 4E 47 0D 0A 1A 0A
                    if (view.getUint32(0) !== 0x89504E47) {
                        throw new Error('不合规的 PNG 文件');
                    }

                    let offset = 8;
                    let charaDataRaw = null;

                    // 遍历 PNG Chunks
                    while (offset < view.byteLength) {
                        const length = view.getUint32(offset);
                        const type = String.fromCharCode(
                            view.getUint8(offset + 4),
                            view.getUint8(offset + 5),
                            view.getUint8(offset + 6),
                            view.getUint8(offset + 7)
                        );

                        // 查找 tEXt 或 zTXt 块
                        if (type === 'tEXt') {
                            const chunkData = new Uint8Array(buffer, offset + 8, length);
                            const text = new TextDecoder('utf-8').decode(chunkData);
                            
                            // 酒馆卡关键字匹配
                            if (text.startsWith('chara\0') || text.startsWith('ccv2\0')) {
                                const base64Str = text.substring(text.indexOf('\0') + 1);
                                charaDataRaw = atob(base64Str);
                                // 解码 UTF-8
                                const bytes = Uint8Array.from(charaDataRaw, c => c.charCodeAt(0));
                                charaDataRaw = new TextDecoder('utf-8').decode(bytes);
                                break;
                            }
                        }
                        offset += 12 + length; // 移动到下一 chunk
                    }

                    // 生成头像的 Base64 URL
                    const avatarBase64 = await this.fileToDataURL(file);

                    if (charaDataRaw) {
                        const parsedJson = JSON.parse(charaDataRaw);
                        // 兼容酒馆 V1 与 V2 角色卡结构
                        const data = parsedJson.data || parsedJson;
                        
                        const name = data.name || '未命名角色';
                        // 组装完整的角色人设提示词
                        const description = [
                            data.description ? `【人设】\n${data.description}` : '',
                            data.personality ? `【性格】\n${data.personality}` : '',
                            data.scenario ? `【场景】\n${data.scenario}` : '',
                            data.first_mes ? `【首条对白】\n${data.first_mes}` : '',
                            data.mes_example ? `【对话示例】\n${data.mes_example}` : ''
                        ].filter(Boolean).join('\n\n');

                        resolve({ name, description, avatar: avatarBase64 });
                    } else {
                        // 如果没有提取到内嵌人设，退化为使用图片文件名
                        const name = file.name.replace(/\.[^/.]+$/, "");
                        resolve({ name, description: '未检测到内嵌酒馆人设，已生成头像。', avatar: avatarBase64 });
                    }
                } catch (err) {
                    console.warn('酒馆卡解析提示:', err);
                    const avatarBase64 = await this.fileToDataURL(file);
                    resolve({ name: file.name.replace(/\.[^/.]+$/, ""), description: '', avatar: avatarBase64 });
                }
            };
        });
    },

    // 辅助工具：File 转 DataURL
    fileToDataURL(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.readAsDataURL(file);
        });
    }
};
