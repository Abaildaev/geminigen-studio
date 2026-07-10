import React, { useState, useEffect, useRef } from 'react';
import { 
  Upload, 
  Play, 
  Settings, 
  Trash2, 
  RefreshCw, 
  Sparkles, 
  Key, 
  AlertCircle, 
  Loader2, 
  Video, 
  Download, 
  Database,
  Image as ImageIcon,
  Palette,
} from 'lucide-react';
import JSZip from 'jszip';
import type { AnimationTask } from './types';
import ImageGenerator from './ImageGenerator';
import StyleTransfer from './StyleTransfer';

export default function App() {
  const [apiKey, setApiKey] = useState<string>(() => {
    return localStorage.getItem('geminigen_api_key') || '';
  });
  const [showKeyInput, setShowKeyInput] = useState(!apiKey);
  const [activeTab, setActiveTab] = useState<'video' | 'image' | 'style'>('video');
  
  // Tasks Queue
  const [tasks, setTasks] = useState<AnimationTask[]>([]);
  
  // Global defaults
  const [globalPrompt, setGlobalPrompt] = useState('Кинематографичное движение камеры вперед, реалистичное динамичное освещение, высокое качество');
  const [globalModel, setGlobalModel] = useState<AnimationTask['model']>('grok-3');
  const [globalAspectRatio, setGlobalAspectRatio] = useState<'portrait' | 'landscape'>('landscape');
  const [globalDuration, setGlobalDuration] = useState<string>('10');
  const [globalResolution, setGlobalResolution] = useState<string>('720p');
  
  // Queue controller state
  const [isProcessingAll, setIsProcessingAll] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState('');
  const queueTimeoutRef = useRef<any>(null);

  // Keep a map of active polling intervals by task ID to clean them up on unmount or task removal
  const activePolls = useRef<{ [taskId: string]: any }>({});

  // Individual task logging
  const [taskLogs, setTaskLogs] = useState<{ [taskId: string]: string[] }>({});
  const [batchPrompts, setBatchPrompts] = useState('');
  const [lightbox, setLightbox] = useState<{ url: string; type: 'image' | 'video'; name: string } | null>(null);

  // Sync API Key to LocalStorage
  const handleSaveApiKey = (key: string) => {
    const cleanKey = key.trim();
    setApiKey(cleanKey);
    localStorage.setItem('geminigen_api_key', cleanKey);
    setShowKeyInput(false);
  };

  const addLog = (taskId: string, message: string) => {
    const time = new Date().toLocaleTimeString();
    setTaskLogs(prev => ({
      ...prev,
      [taskId]: [...(prev[taskId] || []), `[${time}] ${message}`]
    }));
  };

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      Object.values(activePolls.current).forEach(clearInterval);
      if (queueTimeoutRef.current) clearTimeout(queueTimeoutRef.current);
    };
  }, []);

  // Detect image aspect ratio automatically
  const detectAspectRatio = (width: number, height: number, model: string): any => {
    const ratio = width / height;
    if (model === 'grok-3') {
      if (ratio > 1.25) return 'landscape';
      if (ratio < 0.8) return 'portrait';
      return 'square';
    } else {
      // veo-3.1-fast only supports 16:9
      return '16:9';
    }
  };

  // Handle file uploading — загружаем все файлы параллельно, но добавляем в стейт строго по порядку
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent<HTMLDivElement>) => {
    let files: FileList | null = null;
    
    if ('files' in e.target) {
      files = e.target.files;
    } else if ('dataTransfer' in e) {
      e.preventDefault();
      files = e.dataTransfer.files;
    }

    if (!files) return;

    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    // Загружаем размеры всех изображений параллельно, но Promise.all сохраняет порядок
    const loadPromises = imageFiles.map((file, index) => {
      return new Promise<AnimationTask>((resolve) => {
        const previewUrl = URL.createObjectURL(file);
        const img = new Image();
        img.src = previewUrl;
        img.onload = () => {
          resolve({
            id: `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            file,
            previewUrl,
            fileName: file.name,
            width: img.width,
            height: img.height,
            model: globalModel,
            prompt: globalPrompt || 'Реалистичное движение, высокое качество',
            aspectRatio: (() => {
              if (globalModel === 'veo-3.1-fast') {
                return '16:9';
              }
              return globalAspectRatio;
            })(),
            resolution: globalModel === 'grok-3' 
              ? (globalResolution === '480p' || globalResolution === '720p' ? globalResolution as any : '720p')
              : (globalResolution === '1080p' ? '1080p' : '720p'),
            duration: globalModel === 'grok-3' ? globalDuration : '8',
            status: 'idle',
            progress: 0
          });
        };
      });
    });

    const newTasks = await Promise.all(loadPromises);
    setTasks(prev => [...prev, ...newTasks]);
    newTasks.forEach(task => {
      addLog(task.id, `Изображение успешно загружено: ${task.fileName} (${task.width}x${task.height}px)`);
    });
  };

  const updateTaskField = (id: string, field: keyof AnimationTask, value: any) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        const updated = { ...t, [field]: value };
        // If model changes, adjust aspect ratio formats and resolutions
        if (field === 'model') {
          const model = value as AnimationTask['model'];
          updated.model = model;
          updated.resolution = model === 'grok-3' 
            ? (globalResolution === '480p' || globalResolution === '720p' ? globalResolution as any : '720p')
            : '1080p';
          updated.duration = model === 'grok-3' ? globalDuration : '8';
          updated.aspectRatio = model === 'grok-3' ? globalAspectRatio : '16:9';
        }
        return updated;
      }
      return t;
    }));
  };

  const removeTask = (id: string) => {
    if (activePolls.current[id]) {
      clearInterval(activePolls.current[id]);
      delete activePolls.current[id];
    }
    setTasks(prev => {
      const task = prev.find(t => t.id === id);
      if (task) URL.revokeObjectURL(task.previewUrl);
      return prev.filter(t => t.id !== id);
    });
    setTaskLogs(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const clearQueue = () => {
    Object.values(activePolls.current).forEach(clearInterval);
    activePolls.current = {};
    tasks.forEach(t => URL.revokeObjectURL(t.previewUrl));
    setTasks([]);
    setTaskLogs({});
    setIsProcessingAll(false);
  };

  const applyGlobalPrompt = () => {
    setTasks(prev => prev.map(t => {
      if (t.status === 'idle') {
        addLog(t.id, `Применен глобальный промпт: "${globalPrompt}"`);
        return { ...t, prompt: globalPrompt };
      }
      return t;
    }));
  };

  // Распределение промтов по кадрам: каждый абзац (разделённый пустой строкой) = один промт
  const applyBatchPrompts = () => {
    // Разбиваем по пустым строкам (двойной перенос)
    const blocks = batchPrompts.split(/\n\s*\n/).map(block => {
      // Убираем заголовки вида «Сцена 1», «Scene 2», «1.», «#1» и т.п.
      const cleaned = block
        .split('\n')
        .filter(line => !/^\s*(сцена|scene|кадр|frame|#)?\s*\d+\s*$/i.test(line.trim()))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      return cleaned;
    }).filter(b => b.length > 0);

    if (blocks.length === 0) return;
    
    setTasks(prev => prev.map((t, idx) => {
      if (idx < blocks.length && (t.status === 'idle' || t.status === 'failed')) {
        return { ...t, prompt: blocks[idx] };
      }
      return t;
    }));

    const applied = Math.min(blocks.length, tasks.length);
    const extra = blocks.length - tasks.length;
    alert(`✅ Промты распределены: ${applied} из ${tasks.length} кадров.${extra > 0 ? `\n⚠️ Лишних сцен: ${extra}` : ''}${tasks.length > blocks.length ? `\n⚠️ Кадров без промта: ${tasks.length - blocks.length}` : ''}`);
  };
  // Submit Generation Request to API (uses CORS proxy on Vite)
  const submitTask = async (task: AnimationTask): Promise<string> => {
    if (!apiKey) throw new Error('API ключ не задан. Введите его в настройках вверху страницы.');
    
    addLog(task.id, `Подготовка задачи анимации через модель ${task.model}...`);
    
    const formData = new FormData();
    formData.append('prompt', task.prompt);
    formData.append('model', task.model);

    const isGrok = task.model === 'grok-3';

    // Нормализуем соотношение сторон под строгие требования каждой модели
    let normalizedRatio = task.aspectRatio;
    if (isGrok) {
      if (task.aspectRatio === '9:16' || task.aspectRatio === 'portrait') {
        normalizedRatio = 'portrait';
      } else {
        normalizedRatio = 'landscape';
      }
    } else {
      // veo-3.1, veo-3.1-fast, veo-3.1-lite only support 16:9
      normalizedRatio = '16:9';
    }
    formData.append('aspect_ratio', normalizedRatio);

    if (isGrok) {
      // Grok: resolution 480p/720p, duration 6/10/15s, files для загрузки
      formData.append('resolution', task.resolution || '720p');
      formData.append('duration', task.duration || '10');
      formData.append('mode', 'custom');
      formData.append('files', task.file, task.fileName);
    } else {
      // Veo: resolution 720p/1080p, duration 8s, ref_images для загрузки
      formData.append('resolution', task.resolution || '720p');
      formData.append('duration', '8');
      formData.append('mode_image', 'frame');
      formData.append('ref_images', task.file, task.fileName);
    }

    const endpoint = isGrok ? '/api-snapgen/uapi/v1/video-gen/grok' : '/api-snapgen/uapi/v1/video-gen/veo';
    
    addLog(task.id, `Отправка запроса к API эндпоинту: ${endpoint}`);
    
    // Выводим отправленные ключи FormData для отладки
    const sentKeys = Array.from((formData as any).keys());
    addLog(task.id, `Отправленные поля FormData: ${sentKeys.join(', ')}`);
    addLog(task.id, `Соотношение сторон: ${normalizedRatio}, разрешение: ${task.resolution || '720p'}`);
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey
      },
      body: formData
    });

    if (!response.ok) {
      const errText = await response.text();
      addLog(task.id, `Полный ответ API (${response.status}): ${errText.slice(0, 500)}`);
      let errMsg = `Ошибка HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(errText);
        // Извлекаем сообщение — оно может быть строкой или вложенным объектом
        const raw = errJson.error_message || errJson.message || errJson.detail || errJson.error;
        if (raw) {
          errMsg = typeof raw === 'string' ? raw : JSON.stringify(raw);
        } else {
          // Если ни одно стандартное поле не найдено — показываем весь JSON
          errMsg += `: ${JSON.stringify(errJson).slice(0, 400)}`;
        }
      } catch (e) {
        if (errText) errMsg += `: ${errText.slice(0, 400)}`;
      }
      throw new Error(errMsg);
    }

    const data = await response.json();
    if (!data.uuid) {
      throw new Error('API не вернул UUID задачи');
    }

    addLog(task.id, `Задача успешно создана! UUID: ${data.uuid}`);
    return data.uuid;
  };

  // Poll Task Status until finished
  const startPolling = (taskId: string, uuid: string, model: string) => {
    if (activePolls.current[taskId]) {
      clearInterval(activePolls.current[taskId]);
    }

    addLog(taskId, `Запуск опроса статуса (каждые 5 сек) для UUID: ${uuid}`);
    
    const checkStatus = async () => {
      try {
        const historyUrl = `/api-snapgen/uapi/v1/history/${uuid}`;
        const response = await fetch(historyUrl, {
          headers: {
            'x-api-key': apiKey
          }
        });

        if (!response.ok) {
          addLog(taskId, `Предупреждение при опросе: статус HTTP ${response.status}`);
          return; // Keep polling, temporary network glitches shouldn't break the loop
        }

        const data = await response.json();
        const entry = data.result?.result || data.result || data;

        if (!entry) {
          addLog(taskId, 'Ошибка опроса: получено пустое тело ответа');
          return;
        }

        // Set status percentage if available
        if (entry.status_percentage !== undefined) {
          setTasks(prev => prev.map(t => 
            t.id === taskId ? { ...t, progress: entry.status_percentage } : t
          ));
          addLog(taskId, `Прогресс: ${entry.status_percentage}%`);
        }

        const status = Number(entry.status);

        if (status === 2) {
          // Complete! Extract URL based on priority
          let videoUrl = '';
          if (entry.generated_video?.[0]?.video_url) {
            videoUrl = entry.generated_video[0].video_url;
          } else if (entry.media_url) {
            videoUrl = entry.media_url;
          } else if (entry.generate_result) {
            videoUrl = entry.generate_result;
          }

          if (videoUrl) {
            addLog(taskId, `Генерация успешно завершена! Ссылка на видео: ${videoUrl}`);
            setTasks(prev => prev.map(t => 
              t.id === taskId ? { ...t, status: 'completed', progress: 100, videoUrl } : t
            ));
            clearInterval(activePolls.current[taskId]);
            delete activePolls.current[taskId];
          } else {
            // Edge case fallback
            const jsonStr = JSON.stringify(data);
            const match = jsonStr.match(/(https?:\/\/[^"]+\.mp4[^"]*)/) || jsonStr.match(/(https?:\/\/[^"]+\.png[^"]*)/);
            if (match) {
              videoUrl = match[1];
              addLog(taskId, `Ссылка извлечена из JSON: ${videoUrl}`);
              setTasks(prev => prev.map(t => 
                t.id === taskId ? { ...t, status: 'completed', progress: 100, videoUrl } : t
              ));
              clearInterval(activePolls.current[taskId]);
              delete activePolls.current[taskId];
            } else {
              throw new Error('Статус завершен (2), но не удалось найти ссылку на видео в ответе');
            }
          }
        } else if (status > 2) {
          const errMsg = entry.error_message || `Генерация завершилась ошибкой с кодом ${status}`;
          throw new Error(errMsg);
        }
      } catch (err: any) {
        addLog(taskId, `Ошибка при опросе статуса: ${err.message}`);
        setTasks(prev => prev.map(t => 
          t.id === taskId ? { ...t, status: 'failed', error: err.message } : t
        ));
        clearInterval(activePolls.current[taskId]);
        delete activePolls.current[taskId];
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    activePolls.current[taskId] = interval;
  };

  // Run single generation task
  const runSingleTask = async (taskId: string) => {
    setTasks(prev => prev.map(t => 
      t.id === taskId ? { ...t, status: 'submitting', error: undefined, progress: 0 } : t
    ));

    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    try {
      const uuid = await submitTask(task);
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: 'polling', uuid } : t
      ));
      startPolling(taskId, uuid, task.model);
    } catch (err: any) {
      addLog(taskId, `Не удалось отправить задачу: ${err.message}`);
      setTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: 'failed', error: err.message } : t
      ));
    }
  };

  // Process all pending tasks in the queue with a throttle delay
  const processQueue = async () => {
    if (isProcessingAll) return;
    setIsProcessingAll(true);
    
    const pendingTasks = tasks.filter(t => t.status === 'idle' || t.status === 'failed');
    
    for (let i = 0; i < pendingTasks.length; i++) {
      const task = pendingTasks[i];
      
      if (!isProcessingAll && i > 0) {
        const checkActive = await new Promise(resolve => {
          setTasks(current => {
            const stillActive = current.some(c => c.id === task.id && (c.status === 'idle' || c.status === 'failed'));
            resolve(stillActive);
            return current;
          });
        });
        if (!checkActive) break;
      }

      await runSingleTask(task.id);
      
      if (i < pendingTasks.length - 1) {
        addLog('system', `Ожидание 3 сек перед отправкой следующей задачи для предотвращения лимитов API...`);
        await new Promise(resolve => {
          queueTimeoutRef.current = setTimeout(resolve, 3000);
        });
      }
    }
    
    setIsProcessingAll(false);
  };

  // Download all completed videos as a structured ZIP file
  const downloadAllAsZip = async () => {
    const completedTasks = tasks.filter(t => t.status === 'completed' && t.videoUrl);
    if (completedTasks.length === 0) {
      alert('Нет готовых видео для скачивания!');
      return;
    }

    setIsZipping(true);
    const zip = new JSZip();

    try {
      for (let i = 0; i < completedTasks.length; i++) {
        const task = completedTasks[i];
        const indexStr = String(i + 1).padStart(2, '0');
        const cleanName = task.fileName.split('.')[0].replace(/[^a-zA-Z0-9А-Яа-я-_]/g, '_');
        const zipFileName = `${indexStr}_${cleanName}.mp4`;
        
        setZipProgress(`Скачивание видео ${i + 1} из ${completedTasks.length}: ${task.fileName}...`);
        
        const response = await fetch(task.videoUrl!);
        if (!response.ok) {
          throw new Error(`Не удалось загрузить файл ${task.fileName}`);
        }
        
        const blob = await response.blob();
        zip.file(zipFileName, blob);
      }

      setZipProgress('Упаковка архива...');
      const content = await zip.generateAsync({ type: 'blob' });
      
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `grok_animations_${Date.now()}.zip`;
      link.click();
      
      setTimeout(() => URL.revokeObjectURL(link.href), 100);
      setZipProgress('');
    } catch (err: any) {
      alert(`Ошибка при создании архива: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const activeGenerationsCount = tasks.filter(t => t.status === 'submitting' || t.status === 'polling').length;
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'idle': return 'В очереди';
      case 'submitting': return 'Отправка...';
      case 'polling': return 'Генерируется';
      case 'completed': return 'Готово';
      case 'failed': return 'Ошибка';
      default: return status;
    }
  };

  return (
    <div className="app-container">
      {/* HEADER SECTION */}
      <header className="header">
        <div className="title-section">
          <h1>
            <Sparkles className="text-purple-400 spin-slow" size={32} style={{ color: 'var(--accent-purple)' }} />
            GeminiGen Studio
          </h1>
          <p>Массовая генерация изображений и видео с помощью AI</p>
        </div>

        {/* API KEY PANEL */}
        <div className="api-settings">
          {showKeyInput ? (
            <div className="glass-panel" style={{ padding: '8px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Key size={18} className="text-purple-400" style={{ color: 'var(--accent-purple)' }} />
              <input 
                type="password" 
                placeholder="Введите ключ geminiai-xxxxxxxx..." 
                defaultValue={apiKey} 
                id="apiKeyInput"
                style={{ width: '240px', padding: '6px 10px', fontSize: '0.85rem' }} 
              />
              <button 
                className="primary" 
                style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                onClick={() => {
                  const input = document.getElementById('apiKeyInput') as HTMLInputElement;
                  if (input) handleSaveApiKey(input.value);
                }}
              >
                Сохранить
              </button>
            </div>
          ) : (
            <div 
              className="glass-panel" 
              style={{ padding: '8px 16px', display: 'flex', gap: '10px', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setShowKeyInput(true)}
            >
              <Database size={16} className="text-green-400" style={{ color: 'var(--success)' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>API Подключен</span>
              <Settings size={14} className="text-slate-400" />
            </div>
          )}
        </div>
      </header>

      {/* TAB NAVIGATION */}
      <nav className="tab-nav">
        <button 
          className={`tab-btn ${activeTab === 'video' ? 'active' : ''}`} 
          onClick={() => setActiveTab('video')}
        >
          <Video size={18} />
          <span>Оживление видео</span>
        </button>
        <button 
          className={`tab-btn ${activeTab === 'image' ? 'active' : ''}`} 
          onClick={() => setActiveTab('image')}
        >
          <ImageIcon size={18} />
          <span>Генерация изображений</span>
        </button>
        <button 
          className={`tab-btn ${activeTab === 'style' ? 'active' : ''}`} 
          onClick={() => setActiveTab('style')}
        >
          <Palette size={18} />
          <span>Перенос стиля</span>
        </button>
      </nav>

      {/* IMAGE GENERATION TAB */}
      {activeTab === 'image' && <ImageGenerator apiKey={apiKey} />}

      {/* STYLE TRANSFER TAB */}
      {activeTab === 'style' && <StyleTransfer apiKey={apiKey} />}

      {/* VIDEO ANIMATION TAB */}
      {activeTab === 'video' && (<>
      {/* GLOBAL QUEUE CONTROLS */}
      <section className="glass-panel" style={{ padding: '24px', marginBottom: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', alignItems: 'end', flexWrap: 'wrap' }} className="responsive-controls-grid">
          {/* Default values configuration */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Общий промпт движения</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea 
                rows={2}
                value={globalPrompt} 
                onChange={(e) => setGlobalPrompt(e.target.value)}
                placeholder="Опишите, как должна двигаться камера или объекты на сцене..."
                style={{ width: '100%', resize: 'none' }}
              />
              <button 
                className="secondary" 
                style={{ height: 'fit-content', alignSelf: 'center', whiteSpace: 'nowrap' }}
                onClick={applyGlobalPrompt}
                title="Перезаписать промпты движения для всех неготовых карточек в очереди"
              >
                Применить ко всем
              </button>
            </div>
          </div>

          {/* Quick Defaults */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', 
            gap: '12px',
            width: '100%'
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Модель по умолчанию</label>
              <select 
                value={globalModel} 
                onChange={(e) => {
                  const val = e.target.value as any;
                  setGlobalModel(val);
                  if (val === 'veo-3.1-fast') {
                    if (globalAspectRatio !== 'landscape') {
                      setGlobalAspectRatio('landscape');
                    }
                    setGlobalResolution('1080p');
                    setGlobalDuration('8');
                  } else {
                    setGlobalResolution('720p');
                    setGlobalDuration('10');
                  }
                }}
                style={{ width: '100%' }}
              >
                <option value="grok-3">Grok</option>
                <option value="veo-3.1-fast">Veo 3.1</option>
              </select>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Формат сторон по умолчанию</label>
              <select 
                value={globalAspectRatio} 
                onChange={(e) => setGlobalAspectRatio(e.target.value as any)}
                disabled={globalModel === 'veo-3.1-fast'}
                style={{ width: '100%' }}
              >
                <option value="portrait">Вертикальный (Grok: portrait / Veo: 9:16)</option>
                <option value="landscape">Горизонтальный (Grok: landscape / Veo: 16:9)</option>
              </select>
            </div>

            {globalModel === 'grok-3' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Длительность по умолчанию</label>
                <select 
                  value={globalDuration} 
                  onChange={(e) => {
                    const val = e.target.value;
                    setGlobalDuration(val);
                    setTasks(prev => prev.map(t => t.model === 'grok-3' && (t.status === 'idle' || t.status === 'failed') ? { ...t, duration: val } : t));
                  }}
                  style={{ width: '100%' }}
                >
                  <option value="6">6 секунд</option>
                  <option value="10">10 секунд</option>
                  <option value="15">15 секунд</option>
                </select>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>Разрешение по умолчанию</label>
              <select 
                value={globalResolution} 
                onChange={(e) => {
                  const val = e.target.value;
                  setGlobalResolution(val);
                  setTasks(prev => prev.map(t => (t.status === 'idle' || t.status === 'failed') ? { ...t, resolution: val as any } : t));
                }}
                style={{ width: '100%' }}
              >
                {globalModel === 'grok-3' ? (
                  <>
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                  </>
                ) : (
                  <>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </>
                )}
              </select>
            </div>
          </div>
        </div>

        {/* BATCH PROMPTS — вставка списка промтов для всех кадров разом */}
        {tasks.length > 0 && (
          <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px' }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
              📋 Пакетные промты (по сценам)
              <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                — разделяйте сцены пустой строкой, заголовки «Сцена N» автоматически убираются
              </span>
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <textarea
                rows={8}
                value={batchPrompts}
                onChange={(e) => setBatchPrompts(e.target.value)}
                placeholder={`Сцена 1\nПерсонажи поднимают бокалы и улыбаются, камера делает медленный push-in\n\nСцена 2\nКамера медленно приближается к лицу, драматичный свет\n\nСцена 3\nВзрыв конфетти, все радуются, камера отъезжает назад...`}
                style={{ width: '100%', resize: 'vertical', fontSize: '0.85rem', fontFamily: 'inherit', lineHeight: '1.6' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 }}>
                <button
                  className="primary"
                  style={{ whiteSpace: 'nowrap', padding: '8px 16px', fontSize: '0.85rem' }}
                  onClick={applyBatchPrompts}
                  disabled={batchPrompts.trim().length === 0}
                  title="Каждая сцена (абзац) будет подставлена как промт для кадра с тем же номером"
                >
                  Распределить
                </button>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                  {batchPrompts.trim() ? `${batchPrompts.split(/\n\s*\n/).filter(b => b.trim()).length} сцен` : ''}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* DRAG AND DROP AREA */}
        <div style={{ marginTop: '24px' }}>
          <div 
            className="drag-drop-zone"
            onDragOver={handleDragOver}
            onDrop={handleFileUpload}
            onClick={() => document.getElementById('bulk-file-upload')?.click()}
          >
            <Upload size={40} className="text-purple-400" style={{ color: 'var(--accent-purple)', animation: 'float 3s ease-in-out infinite' }} />
            <div>
              <p style={{ margin: '0 0 4px 0', fontWeight: 700, fontSize: '1.1rem' }}>
                Перетащите изображения сюда или нажмите, чтобы <span style={{ color: 'var(--accent-purple)' }}>выбрать файлы</span>
              </p>
              <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Поддерживаются форматы PNG, JPG, JPEG. Можно выбрать несколько файлов сразу.
              </p>
            </div>
            <input 
              id="bulk-file-upload" 
              type="file" 
              multiple 
              accept="image/*" 
              onChange={handleFileUpload} 
              style={{ display: 'none' }} 
            />
          </div>
        </div>

        {/* BULK ACTION CONTROLS */}
        {tasks.length > 0 && (
          <div className="controls-bar" style={{ marginTop: '24px', borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: '16px' }}>
            <div className="stats-group">
              <span>Всего элементов: <strong>{tasks.length}</strong></span>
              <span>В процессе: <strong style={{ color: 'var(--accent-purple)' }}>{activeGenerationsCount}</strong></span>
              <span>Готово: <strong style={{ color: 'var(--success)' }}>{completedCount}</strong></span>
              {failedCount > 0 && <span style={{ color: 'var(--danger)' }}>С ошибкой: <strong>{failedCount}</strong></span>}
            </div>

            <div className="controls-group-right">
              <button 
                className="secondary danger" 
                onClick={clearQueue}
                disabled={activeGenerationsCount > 0 || isZipping}
              >
                <Trash2 size={16} />
                Очистить очередь
              </button>

              {completedCount > 0 && (
                <button 
                  className="secondary" 
                  onClick={downloadAllAsZip}
                  disabled={isZipping || activeGenerationsCount > 0}
                  style={{ borderColor: 'var(--accent-blue)', color: '#60a5fa' }}
                >
                  {isZipping ? (
                    <>
                      <Loader2 size={16} className="spin" />
                      Скачивание ZIP...
                    </>
                  ) : (
                    <>
                      <Download size={16} />
                      Скачать все ZIP ({completedCount})
                    </>
                  )}
                </button>
              )}

              <button 
                className={`primary ${activeGenerationsCount > 0 ? 'pulse-glow' : ''}`}
                onClick={processQueue}
                disabled={isProcessingAll || isZipping || tasks.filter(t => t.status === 'idle' || t.status === 'failed').length === 0}
              >
                {isProcessingAll ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Оживление...
                  </>
                ) : (
                  <>
                    <Play size={16} />
                    Оживить все в очереди
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ZIP Progress Toast / Banner */}
        {isZipping && (
          <div style={{ 
            marginTop: '16px', 
            padding: '12px 16px', 
            background: 'rgba(59, 130, 246, 0.15)', 
            border: '1px solid rgba(59, 130, 246, 0.3)', 
            borderRadius: '8px',
            fontSize: '0.85rem',
            color: '#93c5fd',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <Loader2 size={16} className="spin" />
            <span>{zipProgress}</span>
          </div>
        )}
      </section>

      {/* QUEUE GRID VIEW */}
      {tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-secondary)' }}>
          <Video size={48} style={{ margin: '0 auto 16px auto', opacity: 0.3 }} />
          <h3 style={{ margin: '0 0 8px 0', color: 'var(--text-primary)' }}>Очередь пуста</h3>
          <p style={{ margin: 0 }}>Загрузите изображения выше, чтобы настроить их параметры движения и начать генерацию видео.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {tasks.map((task, index) => {
            const hasVideo = task.status === 'completed' && task.videoUrl;
            const isWorking = task.status === 'submitting' || task.status === 'polling';
            const isEditable = task.status === 'idle' || task.status === 'failed';
            
            return (
              <div 
                key={task.id} 
                className="glass-panel video-task-row" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '12px', 
                  padding: '10px 16px',
                  transition: 'all 0.2s ease',
                  borderLeft: `3px solid ${
                    task.status === 'completed' ? 'var(--success)' : 
                    task.status === 'failed' ? 'var(--danger)' : 
                    isWorking ? 'var(--accent-purple)' : 
                    'rgba(255,255,255,0.1)'
                  }`
                }}
              >
                {/* Номер кадра */}
                <span className="task-index" style={{ 
                  fontSize: '0.75rem', 
                  fontWeight: 700, 
                  color: 'var(--text-muted)', 
                  minWidth: '24px', 
                  textAlign: 'center' 
                }}>
                  {String(index + 1).padStart(2, '0')}
                </span>

                {/* Мини-превью */}
                <div 
                  className="task-preview"
                  onClick={() => setLightbox({
                    url: hasVideo ? task.videoUrl! : task.previewUrl,
                    type: hasVideo ? 'video' : 'image',
                    name: task.fileName
                  })}
                  style={{ 
                    position: 'relative', 
                    width: '72px', 
                    height: '72px', 
                    flexShrink: 0, 
                    borderRadius: '8px', 
                    overflow: 'hidden',
                    border: '1px solid rgba(255,255,255,0.08)',
                    cursor: 'pointer',
                    transition: 'transform 0.15s ease, border-color 0.15s ease'
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.borderColor = 'var(--accent-purple)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}
                  title="Нажмите для просмотра"
                >
                  {hasVideo ? (
                    <video 
                      src={task.videoUrl} 
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      muted
                      loop
                      autoPlay
                      playsInline
                    />
                  ) : (
                    <img 
                      src={task.previewUrl} 
                      alt={task.fileName}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )}
                  
                  {/* Оверлей процесса */}
                  {isWorking && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(9, 13, 22, 0.85)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '2px'
                    }}>
                      <Loader2 size={18} className="spin" style={{ color: 'var(--accent-purple)' }} />
                      <span style={{ fontSize: '0.6rem', fontWeight: 700 }}>{task.progress}%</span>
                    </div>
                  )}

                  {/* Оверлей ошибки */}
                  {task.status === 'failed' && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'rgba(239, 68, 68, 0.85)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}>
                      <AlertCircle size={20} />
                    </div>
                  )}
                </div>

                {/* Имя файла и размер */}
                <div className="task-filename-wrapper" style={{ minWidth: '120px', maxWidth: '150px', flexShrink: 0, overflow: 'hidden' }}>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    fontWeight: 600, 
                    textOverflow: 'ellipsis', 
                    overflow: 'hidden', 
                    whiteSpace: 'nowrap' 
                  }} title={task.fileName}>
                    {task.fileName}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                    {task.width}×{task.height}px
                  </div>
                </div>

                {/* Промпт — основное поле, занимает доступное пространство */}
                <div className="task-prompt-wrapper" style={{ flex: 1, minWidth: 0 }}>
                  <textarea
                    rows={2}
                    value={task.prompt}
                    onChange={(e) => updateTaskField(task.id, 'prompt', e.target.value)}
                    disabled={!isEditable}
                    placeholder="Промпт движения..."
                    style={{ 
                      fontSize: '0.8rem', 
                      resize: 'none', 
                      width: '100%',
                      padding: '6px 10px',
                      background: isEditable ? 'rgba(255,255,255,0.04)' : 'transparent',
                      border: isEditable ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                      borderRadius: '6px',
                      color: 'var(--text-primary)',
                      lineHeight: '1.4'
                    }}
                  />
                </div>

                {/* Модель — компактный селектор */}
                <div className="task-model-wrapper" style={{ display: 'flex', gap: '6px', flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
                  {/* Модель */}
                  <div style={{ minWidth: '85px' }}>
                    <select
                      value={task.model}
                      onChange={(e) => updateTaskField(task.id, 'model', e.target.value as any)}
                      disabled={!isEditable}
                      style={{ 
                        fontSize: '0.7rem', 
                        padding: '4px 6px', 
                        width: '100%',
                        background: isEditable ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: isEditable ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        cursor: isEditable ? 'pointer' : 'default'
                      }}
                      title="Модель"
                    >
                      <option value="grok-3">Grok</option>
                      <option value="veo-3.1-fast">Veo 3.1</option>
                    </select>
                  </div>

                  {/* Формат сторон */}
                  <div style={{ minWidth: '70px' }}>
                    <select
                      value={task.aspectRatio}
                      onChange={(e) => updateTaskField(task.id, 'aspectRatio', e.target.value as any)}
                      disabled={!isEditable || task.model === 'veo-3.1-fast'}
                      style={{ 
                        fontSize: '0.7rem', 
                        padding: '4px 6px', 
                        width: '100%',
                        background: isEditable && task.model !== 'veo-3.1-fast' ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: isEditable && task.model !== 'veo-3.1-fast' ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        cursor: isEditable && task.model !== 'veo-3.1-fast' ? 'pointer' : 'default'
                      }}
                      title="Соотношение сторон"
                    >
                      {task.model === 'veo-3.1-fast' ? (
                        <option value="16:9">16:9</option>
                      ) : (
                        <>
                          <option value="landscape">16:9 (Гор.)</option>
                          <option value="portrait">9:16 (Верт.)</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Длительность */}
                  <div style={{ minWidth: '55px' }}>
                    <select
                      value={task.duration}
                      onChange={(e) => updateTaskField(task.id, 'duration', e.target.value)}
                      disabled={!isEditable || task.model === 'veo-3.1-fast'}
                      style={{ 
                        fontSize: '0.7rem', 
                        padding: '4px 6px', 
                        width: '100%',
                        background: isEditable && task.model !== 'veo-3.1-fast' ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: isEditable && task.model !== 'veo-3.1-fast' ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        cursor: isEditable && task.model !== 'veo-3.1-fast' ? 'pointer' : 'default'
                      }}
                      title="Длительность"
                    >
                      {task.model === 'veo-3.1-fast' ? (
                        <option value="8">8s</option>
                      ) : (
                        <>
                          <option value="6">6s</option>
                          <option value="10">10s</option>
                          <option value="15">15s</option>
                        </>
                      )}
                    </select>
                  </div>

                  {/* Разрешение */}
                  <div style={{ minWidth: '65px' }}>
                    <select
                      value={task.resolution}
                      onChange={(e) => updateTaskField(task.id, 'resolution', e.target.value as any)}
                      disabled={!isEditable}
                      style={{ 
                        fontSize: '0.7rem', 
                        padding: '4px 6px', 
                        width: '100%',
                        background: isEditable ? 'rgba(255,255,255,0.06)' : 'transparent',
                        border: isEditable ? '1px solid rgba(255,255,255,0.1)' : '1px solid transparent',
                        borderRadius: '4px',
                        color: 'var(--text-primary)',
                        cursor: isEditable ? 'pointer' : 'default'
                      }}
                      title="Разрешение"
                    >
                      {task.model === 'grok-3' ? (
                        <>
                          <option value="480p">480p</option>
                          <option value="720p">720p</option>
                        </>
                      ) : (
                        <>
                          <option value="720p">720p</option>
                          <option value="1080p">1080p</option>
                        </>
                      )}
                    </select>
                  </div>
                </div>

                {/* Статус */}
                <div className="task-status-wrapper" style={{ flexShrink: 0, minWidth: '90px', textAlign: 'center' }}>
                  <div className={`status-badge ${task.status}`} style={{ fontSize: '0.7rem', padding: '3px 8px' }}>
                    {getStatusLabel(task.status)}
                  </div>
                  {task.status === 'failed' && task.error && (
                    <div style={{ 
                      fontSize: '0.65rem', 
                      color: 'var(--danger)', 
                      marginTop: '4px',
                      maxWidth: '120px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }} title={task.error}>
                      {task.error}
                    </div>
                  )}
                  {taskLogs[task.id] && taskLogs[task.id].length > 0 && (
                    <details style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px', cursor: 'pointer' }}>
                      <summary style={{ fontWeight: 600 }}>Логи</summary>
                      <div style={{ 
                        position: 'absolute', 
                        right: 0, 
                        zIndex: 10, 
                        background: 'rgba(3, 7, 18, 0.95)', 
                        padding: '8px', 
                        borderRadius: '6px', 
                        maxHeight: '120px', 
                        maxWidth: '300px',
                        overflowY: 'auto', 
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        marginTop: '4px'
                      }}>
                        {taskLogs[task.id].map((log, idx) => (
                          <div key={idx} style={{ marginBottom: '2px' }}>{log}</div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>

                {/* Действия */}
                <div className="task-actions-wrapper" style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                  {hasVideo && (
                    <a 
                      href={task.videoUrl} 
                      download={`grok-anim-${task.fileName.split('.')[0]}.mp4`}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: 'none' }}
                    >
                      <button className="secondary" style={{ padding: '6px 8px' }} title="Скачать видео">
                        <Download size={14} />
                      </button>
                    </a>
                  )}

                  {/* Перегенерация готового видео */}
                  {task.status === 'completed' && (
                    <button 
                      className="secondary" 
                      onClick={() => {
                        setTasks(prev => prev.map(t => 
                          t.id === task.id ? { ...t, status: 'idle' as const, videoUrl: undefined, error: undefined, progress: 0 } : t
                        ));
                        addLog(task.id, 'Сброс для перегенерации');
                      }}
                      style={{ padding: '6px 8px' }}
                      title="Перегенерировать видео"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}

                  {isEditable && (
                    <button 
                      className="primary" 
                      onClick={() => runSingleTask(task.id)}
                      style={{ padding: '6px 10px', fontSize: '0.75rem' }}
                      disabled={isZipping}
                      title="Оживить этот кадр"
                    >
                      <Play size={12} />
                    </button>
                  )}

                  {task.status === 'failed' && (
                    <button 
                      className="secondary" 
                      onClick={() => runSingleTask(task.id)}
                      style={{ padding: '6px 8px' }}
                      title="Повторить"
                    >
                      <RefreshCw size={12} />
                    </button>
                  )}

                  <button 
                    className="danger" 
                    onClick={() => removeTask(task.id)}
                    disabled={isWorking || isZipping}
                    style={{ padding: '6px 8px' }}
                    title="Удалить"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      </>)}
      {/* LIGHTBOX MODAL */}
      {lightbox && (
        <div 
          onClick={() => setLightbox(null)}
          onKeyDown={(e) => e.key === 'Escape' && setLightbox(null)}
          tabIndex={0}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'rgba(0, 0, 0, 0.92)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'zoom-out',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.2s ease'
          }}
          ref={el => el?.focus()}
        >
          <div 
            onClick={e => e.stopPropagation()}
            style={{ 
              position: 'relative', 
              maxWidth: '90vw', 
              maxHeight: '90vh',
              cursor: 'default'
            }}
          >
            {lightbox.type === 'video' ? (
              <video
                src={lightbox.url}
                controls
                autoPlay
                loop
                style={{ 
                  maxWidth: '90vw', 
                  maxHeight: '85vh', 
                  borderRadius: '12px',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5)'
                }}
              />
            ) : (
              <img
                src={lightbox.url}
                alt={lightbox.name}
                style={{ 
                  maxWidth: '90vw', 
                  maxHeight: '85vh', 
                  borderRadius: '12px',
                  boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                  objectFit: 'contain'
                }}
              />
            )}
            <div style={{ 
              textAlign: 'center', 
              marginTop: '12px', 
              color: 'var(--text-secondary)', 
              fontSize: '0.85rem' 
            }}>
              {lightbox.name}
            </div>
            <button
              onClick={() => setLightbox(null)}
              style={{
                position: 'absolute',
                top: '-12px',
                right: '-12px',
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                fontSize: '1.2rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backdropFilter: 'blur(4px)'
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
