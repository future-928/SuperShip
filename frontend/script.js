const { createApp } = Vue;

createApp({
    data() {
        return {
            messages: [],
            userInput: '',
            isLoading: false,
            activeNav: 'newChat',
            API_URL: '/chat',
            abortController: null,
            userId: 'user_' + Math.random().toString(36).substring(2, 11),
            sessionId: 'session_' + Date.now(),
            sessions: [],
            showHistorySidebar: false,
            isComposing: false,
            // 文档管理相关
            documents: [],
            documentsLoading: false,
            selectedFile: null,
            isUploading: false,
            uploadProgress: '',
            // 工作区文件
            workspaceFiles: [],
            // 3D 预览
            previewModel: null,
            previewStatus: 'Idle',
            previewVertices: '--',
            previewFaces: '--',
            _threeApp: null
        };
    },
    mounted() {
        this.configureMarked();
        // 尝试从 localStorage 恢复用户ID
        const savedUserId = localStorage.getItem('userId');
        if (savedUserId) {
            this.userId = savedUserId;
        } else {
            localStorage.setItem('userId', this.userId);
        }
        this.loadWorkspaceFiles();
    },
    methods: {
        configureMarked() {
            marked.setOptions({
                highlight: function(code, lang) {
                    const language = hljs.getLanguage(lang) ? lang : 'plaintext';
                    return hljs.highlight(code, { language }).value;
                },
                langPrefix: 'hljs language-',
                breaks: true,
                gfm: true
            });
        },
        
        parseMarkdown(text) {
            return marked.parse(text);
        },
        
        escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        },
        
        handleCompositionStart() {
            this.isComposing = true;
        },
        
        handleCompositionEnd() {
            this.isComposing = false;
        },
        
        handleKeyDown(event) {
            // 如果是回车键且不是Shift+回车，且不在输入法组合中
            if (event.key === 'Enter' && !event.shiftKey && !this.isComposing) {
                event.preventDefault();
                this.handleSend();
            }
        },
        
        handleStop() {
            if (this.abortController) {
                this.abortController.abort();
            }
        },
        
        async handleSend() {
            const text = this.userInput.trim();
            if (!text || this.isLoading || this.isComposing) return;

            // Add user message
            this.messages.push({
                text: text,
                isUser: true
            });
            
            this.userInput = '';
            this.$nextTick(() => {
                this.resetTextareaHeight();
                this.scrollToBottom();
            });

            // Show loading
            this.isLoading = true;

            // 立刻创建气泡，显示思考动画（二合一：思考 + 流式输出在同一个气泡）
            this.messages.push({ 
                text: '', 
                isUser: false, 
                isThinking: true, 
                ragTrace: null,
                ragSteps: [] 
            });
            const botMsgIdx = this.messages.length - 1;

            // 用于终止请求
            this.abortController = new AbortController();

            try {
                const response = await fetch('/chat/stream', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        message: text,
                        user_id: this.userId,
                        session_id: this.sessionId
                    }),
                    signal: this.abortController.signal,
                });

                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    
                    buffer += decoder.decode(value, { stream: true });
                    
                    let eventEndIndex;
                    while ((eventEndIndex = buffer.indexOf('\n\n')) !== -1) {
                        const eventStr = buffer.slice(0, eventEndIndex);
                        buffer = buffer.slice(eventEndIndex + 2);
                        
                        if (eventStr.startsWith('data: ')) {
                            const dataStr = eventStr.slice(6);
                            if (dataStr === '[DONE]') continue;
                            try {
                                const data = JSON.parse(dataStr);
                                if (data.type === 'content') {
                                    // 收到第一个 token 时关闭思考动画
                                    if (this.messages[botMsgIdx].isThinking) {
                                        this.messages[botMsgIdx].isThinking = false;
                                    }
                                    this.messages[botMsgIdx].text += data.content;
                                } else if (data.type === 'trace') {
                                    this.messages[botMsgIdx].ragTrace = data.rag_trace;
                                } else if (data.type === 'rag_step') {
                                    // 实时 RAG 检索步骤 — 直接显示在思考气泡内
                                    if (!this.messages[botMsgIdx].ragSteps) {
                                        this.messages[botMsgIdx].ragSteps = [];
                                    }
                                    this.messages[botMsgIdx].ragSteps.push(data.step);
                                } else if (data.type === 'error') {
                                    this.messages[botMsgIdx].isThinking = false;
                                    this.messages[botMsgIdx].text += `\n[Error: ${data.content}]`;
                                }
                            } catch (e) {
                                console.warn('SSE parse error:', e);
                            }
                        }
                    }
                    this.$nextTick(() => this.scrollToBottom());
                }

            } catch (error) {
                if (error.name === 'AbortError') {
                    // 用户主动终止
                    this.messages[botMsgIdx].isThinking = false;
                    if (!this.messages[botMsgIdx].text) {
                        this.messages[botMsgIdx].text = '(已终止回答)';
                    } else {
                        this.messages[botMsgIdx].text += '\n\n_(回答已被终止)_';
                    }
                } else {
                    console.error('Error:', error);
                    this.messages[botMsgIdx].isThinking = false;
                    this.messages[botMsgIdx].text = `请求处理失败：${error.message}`;
                }
            } finally {
                this.isLoading = false;
                this.abortController = null;
                this.$nextTick(() => this.scrollToBottom());
                this.loadWorkspaceFiles();
            }
        },
        
        autoResize(event) {
            const textarea = event.target;
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        },
        
        resetTextareaHeight() {
            if (this.$refs.textarea) {
                this.$refs.textarea.style.height = 'auto';
            }
        },
        
        scrollToBottom() {
            if (this.$refs.chatContainer) {
                this.$refs.chatContainer.scrollTop = this.$refs.chatContainer.scrollHeight;
            }
        },
        
        handleNewChat() {
            this.messages = [];
            this.sessionId = 'session_' + Date.now();
            this.activeNav = 'newChat';
            this.showHistorySidebar = false;
        },
        
        handleClearChat() {
            if (confirm('确定要清空当前对话吗？')) {
                this.messages = [];
            }
        },
        
        async handleHistory() {
            this.activeNav = 'history';
            this.showHistorySidebar = true;
            try {
                const response = await fetch(`/sessions/${this.userId}`);
                if (!response.ok) {
                    throw new Error('Failed to load sessions');
                }
                const data = await response.json();
                this.sessions = data.sessions;
            } catch (error) {
                console.error('Error loading sessions:', error);
                alert('加载历史记录失败：' + error.message);
            }
        },
        
        async loadSession(sessionId) {
            this.sessionId = sessionId;
            this.showHistorySidebar = false;
            this.activeNav = 'newChat';
            
            // 从后端加载历史消息
            try {
                const response = await fetch(`/sessions/${this.userId}/${sessionId}`);
                if (!response.ok) {
                    throw new Error('Failed to load session messages');
                }
                const data = await response.json();
                
                // 转换消息格式并显示
                this.messages = data.messages.map(msg => ({
                    text: msg.content,
                    isUser: msg.type === 'human',
                    ragTrace: msg.rag_trace || null
                }));
                
                this.$nextTick(() => {
                    this.scrollToBottom();
                });
            } catch (error) {
                console.error('Error loading session:', error);
                alert('加载会话失败：' + error.message);
                this.messages = [];
            }
        },

        async deleteSession(sessionId) {
            if (!confirm(`确定要删除会话 "${sessionId}" 吗？`)) {
                return;
            }

            try {
                const response = await fetch(`/sessions/${this.userId}/${sessionId}`, {
                    method: 'DELETE'
                });

                const payload = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(payload.detail || 'Delete failed');
                }

                this.sessions = this.sessions.filter(s => s.session_id !== sessionId);

                if (this.sessionId === sessionId) {
                    this.messages = [];
                    this.sessionId = 'session_' + Date.now();
                    this.activeNav = 'newChat';
                }

                if (payload.message) {
                    alert(payload.message);
                }
            } catch (error) {
                console.error('Error deleting session:', error);
                alert('删除会话失败：' + error.message);
            }
        },
        
        handleSettings() {
            this.activeNav = 'settings';
            this.showHistorySidebar = false;
            // 加载文档列表
            this.loadDocuments();
        },
        
        async loadDocuments() {
            this.documentsLoading = true;
            try {
                const response = await fetch('/documents');
                if (!response.ok) {
                    throw new Error('Failed to load documents');
                }
                const data = await response.json();
                this.documents = data.documents;
            } catch (error) {
                console.error('Error loading documents:', error);
                alert('加载文档列表失败：' + error.message);
            } finally {
                this.documentsLoading = false;
            }
        },
        
        handleFileSelect(event) {
            const files = event.target.files;
            if (files && files.length > 0) {
                this.selectedFile = files[0];
                this.uploadProgress = '';
            }
        },
        
        async uploadDocument() {
            if (!this.selectedFile) {
                alert('请先选择文件');
                return;
            }
            
            this.isUploading = true;
            this.uploadProgress = '正在上传...';
            
            try {
                const formData = new FormData();
                formData.append('file', this.selectedFile);
                
                const response = await fetch('/documents/upload', {
                    method: 'POST',
                    body: formData
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Upload failed');
                }
                
                const data = await response.json();
                this.uploadProgress = data.message;
                
                // 清空选择
                this.selectedFile = null;
                if (this.$refs.fileInput) {
                    this.$refs.fileInput.value = '';
                }
                
                // 刷新文档列表
                await this.loadDocuments();
                
                // 3秒后清除提示
                setTimeout(() => {
                    this.uploadProgress = '';
                }, 3000);
                
            } catch (error) {
                console.error('Error uploading document:', error);
                this.uploadProgress = '上传失败：' + error.message;
            } finally {
                this.isUploading = false;
            }
        },
        
        async deleteDocument(filename) {
            if (!confirm(`确定要删除文档 "${filename}" 吗？这将同时删除 Milvus 中的所有相关向量。`)) {
                return;
            }
            
            try {
                const response = await fetch(`/documents/${encodeURIComponent(filename)}`, {
                    method: 'DELETE'
                });
                
                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail || 'Delete failed');
                }
                
                const data = await response.json();
                alert(data.message);
                
                // 刷新文档列表
                await this.loadDocuments();
                
            } catch (error) {
                console.error('Error deleting document:', error);
                alert('删除文档失败：' + error.message);
            }
        },
        
        getFileIcon(fileType) {
            if (fileType === 'PDF') {
                return 'fas fa-file-pdf';
            } else if (fileType === 'Word') {
                return 'fas fa-file-word';
            } else if (fileType === 'Excel') {
                return 'fas fa-file-excel';
            }
            return 'fas fa-file';
        },

        // ===== Workspace Files =====

        async loadWorkspaceFiles() {
            try {
                const response = await fetch('/workspace/files');
                if (!response.ok) throw new Error('Failed to load');
                const data = await response.json();
                this.workspaceFiles = data.files;

                // Auto-preview latest STEP file if viewer is already open
                if (this._threeApp && data.files.length > 0) {
                    const stepFile = data.files.find(f =>
                        f.filename.toLowerCase().endsWith('.step') || f.filename.toLowerCase().endsWith('.stp')
                    );
                    if (stepFile) {
                        this.previewStep(stepFile.filename);
                    }
                }
            } catch (e) {
                console.error('Error loading workspace files:', e);
            }
        },

        async deleteWorkspaceFile(filename) {
            if (!confirm(`确定要删除文件 "${filename}" 吗？`)) return;
            try {
                const response = await fetch(`/workspace/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
                if (!response.ok) throw new Error('Delete failed');
                await this.loadWorkspaceFiles();
            } catch (e) {
                console.error('Error deleting file:', e);
                alert('删除文件失败：' + e.message);
            }
        },

        getFileIconClass(filename) {
            const ext = filename.split('.').pop().toLowerCase();
            const map = {
                'pptx': 'fas fa-file-powerpoint',
                'ppt': 'fas fa-file-powerpoint',
                'pdf': 'fas fa-file-pdf',
                'docx': 'fas fa-file-word',
                'doc': 'fas fa-file-word',
                'xlsx': 'fas fa-file-excel',
                'xls': 'fas fa-file-excel',
                'png': 'fas fa-file-image',
                'jpg': 'fas fa-file-image',
                'jpeg': 'fas fa-file-image',
                'svg': 'fas fa-file-image',
                'html': 'fas fa-file-code',
                'css': 'fas fa-file-code',
                'js': 'fas fa-file-code',
                'py': 'fas fa-file-code',
                'json': 'fas fa-file-code',
                'zip': 'fas fa-file-archive',
                'md': 'fas fa-file-alt',
            };
            return map[ext] || 'fas fa-file';
        },

        formatFileSize(bytes) {
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        },

        // ===== 3D Preview =====

        async init3DViewer() {
            if (this._threeApp) return this._threeApp;

            const THREE = await import('three');
            const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');

            const container = this.$refs.viewportContainer;
            const canvas = this.$refs.viewerCanvas;
            const w = container.clientWidth;
            const h = container.clientHeight;

            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0x0c1420);

            const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100000);
            camera.position.set(200, 200, 400);

            const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
            renderer.setSize(w, h);
            renderer.setPixelRatio(window.devicePixelRatio);

            // Lights
            const ambient = new THREE.AmbientLight(0xffffff, 0.6);
            scene.add(ambient);
            const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
            dirLight.position.set(200, 400, 300);
            scene.add(dirLight);
            const dirLight2 = new THREE.DirectionalLight(0x88aaff, 0.3);
            dirLight2.position.set(-200, -100, -200);
            scene.add(dirLight2);

            // Grid
            const grid = new THREE.GridHelper(1000, 20, 0x1a2d40, 0x1a2d40);
            scene.add(grid);

            const controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.1;

            const animate = () => {
                requestAnimationFrame(animate);
                controls.update();
                renderer.render(scene, camera);
            };
            animate();

            this._threeApp = { THREE, scene, camera, renderer, controls, container };
            return this._threeApp;
        },

        async previewStep(filename) {
            this.previewStatus = 'Loading...';
            try {
                const app = await this.init3DViewer();
                const { THREE, scene, camera, controls } = app;

                // Remove previous model
                if (this.previewModel) {
                    scene.remove(this.previewModel);
                    this.previewModel.geometry.dispose();
                    this.previewModel = null;
                }

                const resp = await fetch(`/workspace/preview/${encodeURIComponent(filename)}`);
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || 'Preview failed');
                }

                const data = await resp.json();
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.vertices, 3));
                geometry.setIndex(data.indices);
                geometry.computeVertexNormals();

                const material = new THREE.MeshStandardMaterial({
                    color: 0x5588bb,
                    metalness: 0.3,
                    roughness: 0.5,
                    flatShading: false,
                });
                const mesh = new THREE.Mesh(geometry, material);
                scene.add(mesh);
                this.previewModel = mesh;

                // Auto-fit camera
                geometry.computeBoundingBox();
                const box = geometry.boundingBox;
                const center = new THREE.Vector3();
                box.getCenter(center);
                const size = new THREE.Vector3();
                box.getSize(size);
                const maxDim = Math.max(size.x, size.y, size.z);
                const dist = maxDim * 2;
                camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist);
                controls.target.copy(center);
                controls.update();

                this.previewStatus = 'Loaded';
                this.previewVertices = data.vertex_count.toLocaleString();
                this.previewFaces = data.face_count.toLocaleString();

                this.$nextTick(() => this.resizeViewer());
            } catch (e) {
                console.error('Preview error:', e);
                this.previewStatus = 'Error';
                alert('3D 预览失败：' + e.message);
            }
        },

        clearPreview() {
            if (this._threeApp && this.previewModel) {
                this._threeApp.scene.remove(this.previewModel);
                this.previewModel.geometry.dispose();
            }
            this.previewModel = null;
            this.previewStatus = 'Idle';
            this.previewVertices = '--';
            this.previewFaces = '--';
        },

        resizeViewer() {
            if (!this._threeApp) return;
            const { container, camera, renderer } = this._threeApp;
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
        }
    },
    watch: {
        messages: {
            handler() {
                this.$nextTick(() => {
                    this.scrollToBottom();
                });
            },
            deep: true
        }
    }
}).mount('#app');
