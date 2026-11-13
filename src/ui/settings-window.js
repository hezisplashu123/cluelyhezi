document.addEventListener('DOMContentLoaded', () => {    
    const logger = {
        info: (...args) => console.log('[SettingsWindowUI]', ...args)
    };

    // Get DOM elements
    const closeButton = document.getElementById('closeButton');
    const quitButton = document.getElementById('quitButton');
    const speechProviderSelect = document.getElementById('speechProvider');
    const listeningSourceSelect = document.getElementById('listeningSource');
    const azureKeyInput = document.getElementById('azureKey');
    const azureRegionInput = document.getElementById('azureRegion');
    const whisperCommandInput = document.getElementById('whisperCommand');
    const whisperModelInput = document.getElementById('whisperModel');
    const whisperLanguageInput = document.getElementById('whisperLanguage');
    const whisperDeviceSelect = document.getElementById('whisperDevice');
    const whisperCaptureModeSelect = document.getElementById('whisperCaptureMode');
    const whisperResponseTargetSelect = document.getElementById('whisperResponseTarget');
    const whisperSegmentMsInput = document.getElementById('whisperSegmentMs');
    const geminiKeyInput = document.getElementById('geminiKey');
    const resumeTextInput = document.getElementById('resumeText');
    const resumeStatus = document.getElementById('resumeStatus');
    const saveResumeButton = document.getElementById('saveResumeButton');
    const clearResumeButton = document.getElementById('clearResumeButton');
    const windowGapInput = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
    const activeSkillSelect = document.getElementById('activeSkill');
    const iconGrid = document.getElementById('iconGrid');

    // Check if window.api exists
    if (!window.api) {
        console.error('window.api not available');
        return;
    }
    const mobileStatus = document.getElementById('mobileConnectionStatus');
    const renderMobile = status => {
        if (!status.address) {
            mobileStatus.textContent = 'Phone control is disabled.';
            return;
        }
        const paired = status.devices?.length || 0;
        const connected = status.connectedDevices?.length || 0;
        const connection = connected
            ? `${connected} phone${connected === 1 ? '' : 's'} connected automatically.`
            : paired
                ? `${paired} trusted phone${paired === 1 ? '' : 's'} will reconnect automatically.`
                : 'No phone has logged in yet.';
        mobileStatus.textContent = `Desktop address: ${status.address}. ${connection}`;
    };
    const mobileAction = async action => { try { renderMobile(await action()); } catch (error) { mobileStatus.textContent = error.message; } };
    document.getElementById('mobileEnable').addEventListener('click', () => mobileAction(() => window.electronAPI.setMobileEnabled(true)));
    document.getElementById('mobileDisable').addEventListener('click', () => mobileAction(() => window.electronAPI.setMobileEnabled(false)));
    mobileAction(() => window.electronAPI.getMobileConnection());
    const mobileRefreshTimer = setInterval(() => mobileAction(() => window.electronAPI.getMobileConnection()), 2000);
    window.addEventListener('beforeunload', () => clearInterval(mobileRefreshTimer), { once: true });

    // Legacy enrollment code remains guarded for compatibility with stale
    // cached pages, but the controls and IPC surface are no longer active.
    let cleanupVoiceCapture = () => null;
    const voiceUI = {
        model: document.getElementById('voiceModelStatus'),
        profile: document.getElementById('voiceProfileStatus'),
        microphone: document.getElementById('voiceMicrophone'),
        meter: document.getElementById('voiceMeterFill'),
        quality: document.getElementById('voiceQuality'),
        record: document.getElementById('voiceRecord'),
        cancel: document.getElementById('voiceCancel'),
        test: document.getElementById('voiceTest'),
        remove: document.getElementById('voiceDelete'),
        install: document.getElementById('voiceInstallModel'),
        filter: document.getElementById('voiceFilterEnabled'),
        filterDescription: document.getElementById('voiceFilterDescription'),
        decision: document.getElementById('voiceDecision'),
        similarity: document.getElementById('voiceSimilarity'),
        latency: document.getElementById('voiceLatency'),
        message: document.getElementById('voiceMessage')
    };
    if (voiceUI.model) {
    let voiceCapture = null;
    let voiceStatus = null;

    const voiceSessionId = () => (crypto.randomUUID ? crypto.randomUUID() : `voice-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const setVoiceMessage = (message, error = false) => {
        voiceUI.message.textContent = message;
        voiceUI.message.classList.toggle('voice-error', error);
    };
    const renderVoiceStatus = status => {
        voiceStatus = status;
        const ready = status?.model === 'ready';
        voiceUI.model.textContent = ready
            ? `● Local model ready${status.health?.inferenceMs ? ` · health inference ${status.health.inferenceMs} ms` : ''}`
            : `● ${status?.model || 'unavailable'}${status?.error ? ` — ${status.error}` : ''}`;
        voiceUI.model.classList.toggle('voice-good', ready);
        voiceUI.model.classList.toggle('voice-error', !ready);
        voiceUI.profile.textContent = status?.profile === 'ready'
            ? `● Encrypted profile saved${status.createdAt ? ` · ${new Date(status.createdAt).toLocaleDateString()}` : ''}`
            : '● No voice profile saved';
        voiceUI.filter.checked = !!status?.filterEnabled;
        voiceUI.filter.disabled = !ready || status?.profile !== 'ready' || !!voiceCapture;
        voiceUI.record.disabled = !ready || !!voiceCapture;
        if (!voiceCapture) voiceUI.record.textContent = status?.profile === 'ready' ? 'Replace Voice Profile' : 'Record Voice Profile';
        voiceUI.test.disabled = !ready || status?.profile !== 'ready' || !!voiceCapture;
        if (!voiceCapture) voiceUI.test.textContent = status?.profile === 'ready'
            ? 'Test Voice Detection'
            : 'Test Voice Detection (record a profile first)';
        voiceUI.remove.disabled = status?.profile !== 'ready' || !!voiceCapture;
        voiceUI.filterDescription.textContent = status?.filteringActive
            ? 'Filtering active for desktop microphone and system playback.'
            : 'Filtering inactive. Matching desktop audio is blocked before every transcription provider when enabled.';
    };

    const listVoiceMicrophones = async () => {
        try {
            await window.electronAPI.listVoiceMicrophones();
            const permission = await navigator.mediaDevices.getUserMedia({ audio: true });
            permission.getTracks().forEach(track => track.stop());
            const devices = (await navigator.mediaDevices.enumerateDevices()).filter(device => device.kind === 'audioinput');
            const selected = localStorage.getItem('voiceRecognitionMicrophone') || 'default';
            voiceUI.microphone.innerHTML = '';
            devices.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Microphone ${index + 1}`;
                voiceUI.microphone.appendChild(option);
            });
            if (devices.some(device => device.deviceId === selected)) voiceUI.microphone.value = selected;
            else if (devices.length) voiceUI.microphone.value = devices[0].deviceId;
            localStorage.setItem('voiceRecognitionMicrophone', voiceUI.microphone.value);
        } catch (error) {
            voiceUI.microphone.innerHTML = '<option value="">Microphone permission required</option>';
            setVoiceMessage(`Microphone access failed: ${error.message}`, true);
        }
    };

    cleanupVoiceCapture = () => {
        if (!voiceCapture) return null;
        const capture = voiceCapture;
        voiceCapture = null;
        try { capture.node.onaudioprocess = null; capture.node.disconnect(); } catch (_) {}
        try { capture.source.disconnect(); } catch (_) {}
        try { capture.silent.disconnect(); } catch (_) {}
        capture.stream.getTracks().forEach(track => track.stop());
        capture.context.close().catch(() => {});
        capture.resampler.reset();
        voiceUI.meter.style.width = '0%';
        voiceUI.cancel.style.display = 'none';
        voiceUI.record.textContent = voiceStatus?.profile === 'ready' ? 'Replace Voice Profile' : 'Record Voice Profile';
        voiceUI.test.textContent = 'Test Voice Detection';
        renderVoiceStatus(voiceStatus || {});
        return capture;
    };

    const startVoiceCapture = async mode => {
        if (voiceCapture) return;
        const sessionId = voiceSessionId();
        const start = mode === 'enrollment' ? window.electronAPI.startVoiceEnrollment : window.electronAPI.startVoiceTest;
        await start(sessionId);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: {
                deviceId: voiceUI.microphone.value ? { exact: voiceUI.microphone.value } : undefined,
                echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1
            }});
            const context = new (window.AudioContext || window.webkitAudioContext)();
            await context.resume();
            const source = context.createMediaStreamSource(stream);
            const node = context.createScriptProcessor(2048, 1, 1);
            const silent = context.createGain(); silent.gain.value = 0;
            const resampler = new window.Pcm16Resampler(context.sampleRate, 16000);
            voiceCapture = { mode, sessionId, stream, context, source, node, silent, resampler };
            node.onaudioprocess = event => {
                if (!voiceCapture || voiceCapture.sessionId !== sessionId) return;
                const input = event.inputBuffer.getChannelData(0);
                let sum = 0; for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
                voiceUI.meter.style.width = `${Math.min(100, Math.sqrt(sum / input.length) * 500)}%`;
                const pcm = resampler.process(input);
                if (pcm.length) window.electronAPI.sendVoiceRecordingChunk(sessionId, pcm.buffer);
            };
            source.connect(node); node.connect(silent); silent.connect(context.destination);
            voiceUI.cancel.style.display = '';
            voiceUI.record.disabled = mode !== 'enrollment';
            voiceUI.test.disabled = mode !== 'test';
            if (mode === 'enrollment') voiceUI.record.textContent = 'Stop and Save Profile';
            else voiceUI.test.textContent = 'Stop and Test';
            setVoiceMessage(mode === 'enrollment' ? 'Recording locally… speak naturally for 20–30 seconds.' : 'Testing locally… speak naturally for at least 3 seconds.');
        } catch (error) {
            await window.electronAPI.cancelVoiceEnrollment(sessionId).catch(() => {});
            throw error;
        }
    };

    const finishVoiceCapture = async () => {
        const capture = cleanupVoiceCapture();
        if (!capture) return;
        setVoiceMessage(capture.mode === 'enrollment' ? 'Building encrypted voice profile…' : 'Running local speaker verification…');
        try {
            const completed = capture.mode === 'enrollment'
                ? await window.electronAPI.stopVoiceEnrollment(capture.sessionId)
                : await window.electronAPI.stopVoiceTest(capture.sessionId);
            renderVoiceStatus(completed.status);
            if (capture.mode === 'test') {
                const result = completed.result;
                voiceUI.decision.textContent = result.decision;
                voiceUI.similarity.textContent = Number.isFinite(result.score) ? result.score.toFixed(3) : '—';
                voiceUI.latency.textContent = Number.isFinite(result.totalMs) ? `${result.totalMs} ms` : '—';
                setVoiceMessage(result.decision === 'SELF_MATCH' ? 'Recognized as your voice. This utterance would be ignored.'
                    : result.decision === 'OTHER_SPEAKER' ? 'Recognized as a different speaker. This utterance would be transcribed.'
                        : `Audio would not be forwarded (${result.reason || result.decision}).`, result.decision === 'MODEL_FAILURE');
            } else {
                setVoiceMessage('Encrypted voice profile saved. Run Test Voice Detection before enabling the filter.');
            }
        } catch (error) {
            setVoiceMessage(error.message, true);
            renderVoiceStatus(await window.electronAPI.getVoiceStatus());
        }
    };

    voiceUI.microphone.addEventListener('change', () => localStorage.setItem('voiceRecognitionMicrophone', voiceUI.microphone.value));
    voiceUI.record.addEventListener('click', () => voiceCapture?.mode === 'enrollment' ? finishVoiceCapture() : startVoiceCapture('enrollment').catch(error => setVoiceMessage(error.message, true)));
    voiceUI.test.addEventListener('click', () => voiceCapture?.mode === 'test' ? finishVoiceCapture() : startVoiceCapture('test').catch(error => setVoiceMessage(error.message, true)));
    voiceUI.cancel.addEventListener('click', async () => {
        const capture = cleanupVoiceCapture();
        if (capture) await window.electronAPI.cancelVoiceEnrollment(capture.sessionId);
        setVoiceMessage('Voice recording cancelled. Temporary audio was cleared.');
    });
    voiceUI.filter.addEventListener('change', async () => {
        try { renderVoiceStatus(await window.electronAPI.setVoiceFilterEnabled(voiceUI.filter.checked)); }
        catch (error) { voiceUI.filter.checked = false; setVoiceMessage(error.message, true); }
    });
    voiceUI.remove.addEventListener('click', async () => {
        renderVoiceStatus(await window.electronAPI.deleteVoiceProfile());
        voiceUI.decision.textContent = 'Not tested'; voiceUI.similarity.textContent = '—'; voiceUI.latency.textContent = '—';
        setVoiceMessage('Encrypted voice profile deleted.');
    });
    voiceUI.install.addEventListener('click', async () => {
        voiceUI.install.disabled = true; setVoiceMessage('Installing the pinned local model. This can take several minutes…');
        try { renderVoiceStatus(await window.electronAPI.installVoiceModel()); setVoiceMessage('Local voice model installed and verified with real inference.'); }
        catch (error) { setVoiceMessage(error.message, true); }
        finally { voiceUI.install.disabled = false; }
    });
    window.electronAPI.onVoiceRecordingProgress(progress => {
        if (!voiceCapture || progress.sessionId !== voiceCapture.sessionId) return;
        voiceUI.quality.textContent = `${progress.elapsedSeconds.toFixed(1)} s recorded · ${progress.usableSpeechSeconds.toFixed(1)} s usable speech · ${progress.clippingRatio > .015 ? 'clipping detected' : 'level OK'}`;
    });
    window.electronAPI.onVoiceRecordingError(error => {
        if (voiceCapture && error.sessionId === voiceCapture.sessionId) { cleanupVoiceCapture(); setVoiceMessage(error.message, true); }
    });
    window.electronAPI.onVoiceStatus(renderVoiceStatus);
    window.electronAPI.onVoiceModelInstallProgress(line => setVoiceMessage(String(line).trim() || 'Installing local voice model…'));
    window.addEventListener('beforeunload', () => {
        const capture = cleanupVoiceCapture();
        if (capture) window.electronAPI.cancelVoiceEnrollment(capture.sessionId);
    }, { once: true });
    Promise.all([window.electronAPI.getVoiceStatus(), listVoiceMicrophones()]).then(([status]) => renderVoiceStatus(status)).catch(error => setVoiceMessage(error.message, true));
    }

    // Request current settings when window opens
    const requestCurrentSettings = () => {
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings().then(settings => {
                loadSettingsIntoUI(settings);
            }).catch(error => {
                console.error('Failed to get settings:', error);
            });
        }
    };

    // Close button handler
    if (closeButton) {
        closeButton.addEventListener('click', async () => {
            const capture = cleanupVoiceCapture();
            if (capture) await window.electronAPI.cancelVoiceEnrollment(capture.sessionId).catch(() => {});
            window.api.send('close-settings');
        });
    }

    // Quit button handler with multiple attempts
    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                const capture = cleanupVoiceCapture();
                if (capture) window.electronAPI.cancelVoiceEnrollment(capture.sessionId).catch(() => {});
                // Try multiple ways to quit the app
                if (window.api && window.api.send) {
                    window.api.send('quit-app');
                }
                
                // Also try the electron API if available
                if (window.electronAPI && window.electronAPI.quit) {
                    window.electronAPI.quit();
                }
                
                // Fallback: close the window
                setTimeout(() => {
                    window.close();
                }, 500);
                
            } catch (error) {
                console.error('Error quitting app:', error);
                window.close();
            }
        });
    }

    // Function to load settings into UI
    const loadSettingsIntoUI = (settings) => {
        if (settings.speechProvider && speechProviderSelect) speechProviderSelect.value = settings.speechProvider;
        if (listeningSourceSelect) listeningSourceSelect.value = settings.listeningSource || 'desktop';
        // Always set the input value, even if empty, so the user sees what's
        // currently configured (including env-derived defaults). Previously
        // empty strings were skipped which left stale UI values.
        if (azureKeyInput) azureKeyInput.value = settings.azureKey || '';
        if (azureRegionInput) azureRegionInput.value = settings.azureRegion || '';
        if (whisperCommandInput) whisperCommandInput.value = settings.whisperCommand || '';
        if (whisperModelInput) whisperModelInput.value = settings.whisperModel || '';
        if (whisperLanguageInput) whisperLanguageInput.value = settings.whisperLanguage || '';
        if (whisperDeviceSelect) whisperDeviceSelect.value = settings.whisperDevice || 'auto';
        if (whisperCaptureModeSelect) whisperCaptureModeSelect.value = settings.whisperCaptureMode || 'vad';
        if (whisperResponseTargetSelect) whisperResponseTargetSelect.value = settings.whisperResponseTarget || 'both';
        if (whisperSegmentMsInput) whisperSegmentMsInput.value = settings.whisperSegmentMs || '';
        if (geminiKeyInput) geminiKeyInput.value = settings.geminiKey || '';
        if (resumeTextInput) resumeTextInput.value = settings.resumeText || '';
        updateResumeStatus(settings.resumeStatus);
        if (windowGapInput) windowGapInput.value = settings.windowGap || '';

        // Set Java as default if no coding language is specified
        if (codingLanguageSelect) {
            codingLanguageSelect.value = settings.codingLanguage || 'java';
        }

        if (settings.activeSkill && activeSkillSelect) activeSkillSelect.value = settings.activeSkill;

        // Handle icon selection
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            const iconOptions = iconGrid.querySelectorAll('.icon-option');
            iconOptions.forEach(option => {
                if (option.dataset.icon === selectedIcon) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });
        }

        updateSpeechFieldStates();
    };

    const updateResumeStatus = (status) => {
        if (!resumeStatus) return;
        resumeStatus.classList.toggle('error', !!status?.error);
        if (!status?.configured) {
            resumeStatus.textContent = 'No resume background is saved.';
        } else if (status.error) {
            resumeStatus.textContent = status.error;
        } else {
            const tokens = Number(status.estimatedTokens || 0).toLocaleString();
            const sizeKb = Math.max(1, Math.ceil(Number(status.bytes || 0) / 1024));
            resumeStatus.textContent = `Loaded ${sizeKb} KB · about ${tokens} extra input tokens per answer.`;
        }
    };

    // Load settings when window opens
    window.api.receive('load-settings', (settings) => {
        loadSettingsIntoUI(settings);
    });

    // Listen for settings window shown event
    if (window.electronAPI && window.electronAPI.receive) {
        window.electronAPI.receive('settings-window-shown', () => {
            requestCurrentSettings();
        });

    // Listen for coding language changes from other windows via helper
    window.electronAPI.onCodingLanguageChanged((event, data) => {
            if (data && data.language && codingLanguageSelect) {
                codingLanguageSelect.value = data.language;
                console.log('Language updated from overlay window:', data.language);
            }
    });
    }

    // Save settings helper function
    const saveSettings = () => {
        const settings = {};
        if (speechProviderSelect) settings.speechProvider = speechProviderSelect.value;
        if (listeningSourceSelect) settings.listeningSource = listeningSourceSelect.value;
        if (azureKeyInput) settings.azureKey = azureKeyInput.value;
        if (azureRegionInput) settings.azureRegion = azureRegionInput.value;
        if (whisperCommandInput) settings.whisperCommand = whisperCommandInput.value;
        if (whisperModelInput) settings.whisperModel = whisperModelInput.value;
        if (whisperLanguageInput) settings.whisperLanguage = whisperLanguageInput.value;
        if (whisperDeviceSelect) settings.whisperDevice = whisperDeviceSelect.value;
        if (whisperCaptureModeSelect) settings.whisperCaptureMode = whisperCaptureModeSelect.value;
        if (whisperResponseTargetSelect) settings.whisperResponseTarget = whisperResponseTargetSelect.value;
        if (whisperSegmentMsInput) settings.whisperSegmentMs = whisperSegmentMsInput.value;
        if (geminiKeyInput) settings.geminiKey = geminiKeyInput.value;
        if (windowGapInput) settings.windowGap = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (activeSkillSelect) settings.activeSkill = activeSkillSelect.value;
        
        window.api.send('save-settings', settings);
    };

    const updateSpeechFieldStates = () => {
        const provider = speechProviderSelect ? speechProviderSelect.value : 'azure';

        // Show/hide provider-specific field groups instead of just disabling
        // them. This keeps the settings UI clean — only the relevant fields
        // for the selected provider are visible.
        const azureGroup = document.getElementById('azureFields');
        const whisperGroup = document.getElementById('whisperFields');
        const azureNote = document.getElementById('azureFieldsNote');

        if (azureGroup) {
            azureGroup.style.display = provider === 'azure' ? '' : 'none';
        }
        if (whisperGroup) {
            whisperGroup.style.display = provider === 'whisper' ? '' : 'none';
        }
        if (azureNote) {
            azureNote.style.display = provider === 'azure' ? '' : 'none';
        }

        // Also toggle disabled attribute for any leftover direct field refs
        [azureKeyInput, azureRegionInput].forEach(input => {
            if (input) input.disabled = provider !== 'azure';
        });
        [whisperCommandInput, whisperModelInput, whisperLanguageInput, whisperDeviceSelect,
            whisperCaptureModeSelect, whisperResponseTargetSelect, whisperSegmentMsInput].forEach(input => {
            if (input) input.disabled = provider !== 'whisper';
        });
    };

    // Add event listeners for all inputs
    const inputs = [
        azureKeyInput,
        azureRegionInput,
        whisperCommandInput,
        whisperModelInput,
        whisperLanguageInput,
        whisperDeviceSelect,
        whisperCaptureModeSelect,
        whisperResponseTargetSelect,
        whisperSegmentMsInput,
        geminiKeyInput,
        listeningSourceSelect,
        windowGapInput
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveSettings);
            input.addEventListener('blur', saveSettings);
        }
    });

    if (speechProviderSelect) {
        speechProviderSelect.addEventListener('change', () => {
            updateSpeechFieldStates();
            saveSettings();
        });
    }

    if (saveResumeButton) {
        saveResumeButton.addEventListener('click', async () => {
            try {
                const result = await window.electronAPI.saveResumeContext(resumeTextInput?.value || '');
                if (result?.success) updateResumeStatus(result.status);
                else updateResumeStatus({ configured: true, error: result?.error || 'Could not save resume background.' });
            } catch (error) {
                updateResumeStatus({ configured: true, error: error.message || 'Could not save resume background.' });
            }
        });
    }

    if (clearResumeButton) {
        clearResumeButton.addEventListener('click', async () => {
            const result = await window.electronAPI.saveResumeContext('');
            if (result?.success) {
                if (resumeTextInput) resumeTextInput.value = '';
                updateResumeStatus(result.status);
            } else updateResumeStatus({ configured: true, error: result?.error || 'Could not clear resume background.' });
        });
    }

    // Language selection handler
    if (codingLanguageSelect) {
        codingLanguageSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            // use electronAPI so main broadcast is consistent
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ codingLanguage: lang });
            } else {
                // fallback
                saveSettings();
            }
        });
    }

    // Skill selection handler
    if (activeSkillSelect) {
        activeSkillSelect.addEventListener('change', (e) => {
            saveSettings();
            // Also update the main window
            window.api.send('update-skill', e.target.value);
        });
    }

    updateSpeechFieldStates();

    // Initialize icon grid with correct paths
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity', src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings', src: './assests/icons/settings.png' }
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const iconElement = document.createElement('div');
            iconElement.className = 'icon-option';
            iconElement.dataset.icon = icon.key;
            
            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = icon.name;
            img.onload = () => {
                logger.info('Icon loaded successfully:', icon.src);
            };
            img.onerror = () => {
                console.error('Failed to load icon:', icon.src);
                // Try alternative paths
                const altPaths = [
                    `./assests/${icon.key}.png`,
                    `./assets/icons/${icon.key}.png`,
                    `./assets/${icon.key}.png`
                ];
                
                let pathIndex = 0;
                const tryNextPath = () => {
                    if (pathIndex < altPaths.length) {
                        img.src = altPaths[pathIndex];
                        pathIndex++;
                    } else {
                        img.style.display = 'none';
                        console.error('All icon paths failed for:', icon.key);
                    }
                };
                
                img.onload = () => {
                    logger.info('Icon loaded with alternative path:', img.src);
                };
                
                img.onerror = tryNextPath;
                tryNextPath();
            };
            
            const label = document.createElement('div');
            label.textContent = icon.name;
            
            iconElement.appendChild(img);
            iconElement.appendChild(label);
            
            // Click handler for icon selection
            iconElement.addEventListener('click', () => {                
                // Remove selection from all icons
                iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                // Add selection to clicked icon
                iconElement.classList.add('selected');
                
                // Save the selection - this should trigger the app icon change
                window.api.send('save-settings', { selectedIcon: icon.key });
                
                // Show visual feedback
                iconElement.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    iconElement.style.transform = 'scale(1)';
                }, 100);
            });
            
            iconGrid.appendChild(iconElement);
        });
    };

    // Initialize icon grid
    initializeIconGrid();

    // Request settings on load
    setTimeout(() => {
        requestCurrentSettings();
    }, 200);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.api.send('close-settings');
        }
    });
}); 
