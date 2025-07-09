import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class UnautomatedCaseAnalyzer {
    constructor() {
        this.browser = null;
        this.page = null;
        this.config = this.loadConfig();
        this.testResultsDir = path.join(__dirname, '..', 'test-results');
    }

    loadConfig() {
        try {
            const configPath = path.join(__dirname, '..', 'config.json');
            return JSON.parse(fs.readFileSync(configPath, 'utf8'));
        } catch (error) {
            console.error('❌ config.json読み込みエラー:', error.message);
            return { target_url: null };
        }
    }

    async initialize() {
        try {
            this.browser = await chromium.launch({ headless: false });
            this.page = await this.browser.newPage();
            await this.page.setViewportSize({ width: 1280, height: 720 });
            console.log('✅ ブラウザ初期化完了');
        } catch (error) {
            console.error('❌ ブラウザ初期化失敗:', error.message);
            throw error;
        }
    }

    async cleanup() {
        if (this.browser) {
            await this.browser.close();
            console.log('🧹 ブラウザクリーンアップ完了');
        }
    }

    /**
     * 最新のカバレッジデータから未自動化テストケースを取得
     */
    getLatestUnautomatedCases() {
        try {
            // 最新のカバレッジJSONファイルを取得
            const coverageFiles = fs.readdirSync(this.testResultsDir)
                .filter(file => file.startsWith('TestCoverage_') && file.endsWith('.json'))
                .sort()
                .reverse();

            if (coverageFiles.length === 0) {
                throw new Error('カバレッジファイルが見つかりません');
            }

            const latestFile = path.join(this.testResultsDir, coverageFiles[0]);
            const coverageData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
            
            console.log(`📊 カバレッジデータ使用: ${coverageFiles[0]}`);
            
            // 未自動化テストケースを抽出
            const unautomatedCases = coverageData.detailed_test_cases.filter(
                testCase => testCase.status === 'not_automated'
            );

            console.log(`🔍 未自動化テストケース: ${unautomatedCases.length}件`);
            return unautomatedCases;

        } catch (error) {
            console.error('❌ 未自動化ケース取得エラー:', error.message);
            return [];
        }
    }

    /**
     * DOM解析によるページ構造の詳細取得
     */
    async analyzePageStructure(url) {
        try {
            console.log(`🔍 ページ構造解析開始: ${url}`);
            await this.page.goto(url, { waitUntil: 'networkidle' });

            const domStructure = await this.page.evaluate(() => {
                const structure = {
                    forms: [],
                    inputs: [],
                    buttons: [],
                    links: [],
                    errorElements: [],
                    dynamicElements: []
                };

                // フォーム要素
                document.querySelectorAll('form').forEach((form, index) => {
                    structure.forms.push({
                        index,
                        id: form.id || null,
                        name: form.name || null,
                        action: form.action || null,
                        method: form.method || 'GET',
                        selector: form.id ? `#${form.id}` : `form:nth-child(${index + 1})`
                    });
                });

                // 入力要素
                document.querySelectorAll('input, select, textarea').forEach((input, index) => {
                    const inputInfo = {
                        index,
                        type: input.type || input.tagName.toLowerCase(),
                        name: input.name || null,
                        id: input.id || null,
                        placeholder: input.placeholder || null,
                        required: input.required,
                        disabled: input.disabled,
                        value: input.value || null,
                        selector: input.name ? `[name="${input.name}"]` : 
                                 input.id ? `#${input.id}` : 
                                 `${input.tagName.toLowerCase()}:nth-child(${index + 1})`,
                        visible: input.offsetParent !== null,
                        label: null
                    };

                    // ラベルを取得
                    const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : 
                                 input.closest('label') || 
                                 input.parentElement.querySelector('label');
                    if (label) {
                        inputInfo.label = label.textContent.trim();
                    }

                    structure.inputs.push(inputInfo);
                });

                // ボタン要素
                document.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((button, index) => {
                    structure.buttons.push({
                        index,
                        type: button.type || 'button',
                        text: button.textContent?.trim() || button.value || null,
                        id: button.id || null,
                        disabled: button.disabled,
                        selector: button.id ? `#${button.id}` : 
                                 button.textContent ? `text="${button.textContent.trim()}"` :
                                 `button:nth-child(${index + 1})`,
                        visible: button.offsetParent !== null
                    });
                });

                // エラーメッセージ要素候補
                document.querySelectorAll('.error, .alert, .warning, [class*="error"], [class*="alert"]').forEach((element, index) => {
                    structure.errorElements.push({
                        index,
                        className: element.className,
                        text: element.textContent?.trim() || null,
                        selector: element.className ? `.${element.className.split(' ')[0]}` : null,
                        visible: element.offsetParent !== null
                    });
                });

                // 動的要素（非表示だが存在する要素）
                document.querySelectorAll('[style*="display: none"], [hidden], .hidden').forEach((element, index) => {
                    if (element.tagName.toLowerCase() === 'input' || 
                        element.tagName.toLowerCase() === 'select' || 
                        element.tagName.toLowerCase() === 'textarea') {
                        structure.dynamicElements.push({
                            index,
                            type: element.type || element.tagName.toLowerCase(),
                            name: element.name || null,
                            id: element.id || null,
                            selector: element.name ? `[name="${element.name}"]` : 
                                     element.id ? `#${element.id}` : null,
                            reason: 'hidden'
                        });
                    }
                });

                return structure;
            });

            console.log(`✅ DOM構造解析完了:`);
            console.log(`  📝 フォーム: ${domStructure.forms.length}個`);
            console.log(`  📝 入力欄: ${domStructure.inputs.length}個`);
            console.log(`  📝 ボタン: ${domStructure.buttons.length}個`);
            console.log(`  📝 エラー要素: ${domStructure.errorElements.length}個`);
            console.log(`  📝 動的要素: ${domStructure.dynamicElements.length}個`);

            return domStructure;

        } catch (error) {
            console.error('❌ ページ構造解析エラー:', error.message);
            return null;
        }
    }

    /**
     * 未自動化テストケースをDOM構造に基づいて分類
     */
    categorizeUnautomatedCases(unautomatedCases, domStructure) {
        const categorized = {
            displayValidation: [],
            inputValidation: [],
            errorHandling: [],
            navigation: [],
            compatibility: [],
            complex: []
        };

        unautomatedCases.forEach(testCase => {
            const title = testCase.title.toLowerCase();
            
            if (title.includes('表示確認') && (title.includes('配置') || title.includes('文字化け'))) {
                categorized.displayValidation.push(testCase);
            } else if (title.includes('エラーメッセージ') && title.includes('表示')) {
                categorized.errorHandling.push(testCase);
            } else if (title.includes('入力') && (title.includes('最大文字数') || title.includes('特殊文字'))) {
                categorized.inputValidation.push(testCase);
            } else if (title.includes('画面') && title.includes('遷移')) {
                categorized.navigation.push(testCase);
            } else if (title.includes('os') || title.includes('ブラウザ') || title.includes('環境')) {
                categorized.compatibility.push(testCase);
            } else {
                categorized.complex.push(testCase);
            }
        });

        console.log(`📋 未自動化ケース分類結果:`);
        console.log(`  🎨 表示確認: ${categorized.displayValidation.length}件`);
        console.log(`  ⚠️  エラー処理: ${categorized.errorHandling.length}件`);
        console.log(`  📝 入力検証: ${categorized.inputValidation.length}件`);
        console.log(`  🔗 画面遷移: ${categorized.navigation.length}件`);
        console.log(`  💻 環境互換: ${categorized.compatibility.length}件`);
        console.log(`  🔧 複雑なケース: ${categorized.complex.length}件`);

        return categorized;
    }

    /**
     * 表示確認テストケース用のPlaywrightルート生成
     */
    generateDisplayValidationRoute(testCase, domStructure) {
        const steps = [];
        
        // ページアクセス
        steps.push({
            label: `${testCase.title}のためにページにアクセス`,
            action: 'load',
            target: this.config.target_url
        });

        // 主要入力要素の表示確認
        domStructure.inputs.forEach(input => {
            if (input.visible && input.name) {
                steps.push({
                    label: `${input.label || input.name}入力欄の表示確認`,
                    action: 'waitForSelector',
                    target: input.selector,
                    expected: 'visible'
                });
            }
        });

        // ボタンの表示確認
        domStructure.buttons.forEach(button => {
            if (button.visible && button.text) {
                steps.push({
                    label: `「${button.text}」ボタンの表示確認`,
                    action: 'waitForSelector',
                    target: button.selector,
                    expected: 'visible'
                });
            }
        });

        // レイアウト確認
        steps.push({
            label: 'ページ全体のレイアウト確認',
            action: 'screenshot',
            target: 'full-page'
        });

        return {
            scenario_id: `scenario_display_validation_${Date.now()}`,
            route_id: `display_validation_${Date.now()}`, // 🔄 後方互換性のために保持
            test_case_id: testCase.id,
            category: 'display_validation',
            title: testCase.title,
            steps: steps,
            generated_at: new Date().toISOString(),
            automation_approach: 'dom_structure_based'
        };
    }

    /**
     * エラー処理テストケース用のPlaywrightルート生成
     */
    generateErrorHandlingRoute(testCase, domStructure) {
        const steps = [];
        
        steps.push({
            label: `${testCase.title}のためにページにアクセス`,
            action: 'load',
            target: this.config.target_url
        });

        // 必須フィールドを空のままボタンクリック
        const submitButton = domStructure.buttons.find(btn => 
            btn.text && (btn.text.includes('確認') || btn.text.includes('送信') || btn.text.includes('予約'))
        );

        if (submitButton) {
            steps.push({
                label: '必須項目を未入力のまま送信ボタンをクリック',
                action: 'click',
                target: submitButton.selector
            });

            // エラーメッセージの表示確認
            if (domStructure.errorElements.length > 0) {
                domStructure.errorElements.forEach(errorElement => {
                    steps.push({
                        label: 'エラーメッセージの表示確認',
                        action: 'waitForSelector',
                        target: errorElement.selector,
                        expected: 'visible'
                    });
                });
            } else {
                // 一般的なエラーメッセージセレクタで確認
                steps.push({
                    label: 'エラーメッセージの表示確認',
                    action: 'waitForSelector',
                    target: '.error, .alert-danger, [class*="error"]',
                    expected: 'visible'
                });
            }
        }

        return {
            scenario_id: `scenario_error_handling_${Date.now()}`,
            route_id: `error_handling_${Date.now()}`, // 🔄 後方互換性のために保持
            test_case_id: testCase.id,
            category: 'error_handling',
            title: testCase.title,
            steps: steps,
            generated_at: new Date().toISOString(),
            automation_approach: 'error_validation_based'
        };
    }

    /**
     * 入力検証テストケース用のPlaywrightルート生成
     */
    generateInputValidationRoute(testCase, domStructure) {
        const steps = [];
        
        steps.push({
            label: `${testCase.title}のためにページにアクセス`,
            action: 'load',
            target: this.config.target_url
        });

        // 特殊文字・最大文字数テスト
        const textInputs = domStructure.inputs.filter(input => 
            input.type === 'text' || input.type === 'email' || input.type === 'textarea'
        );

        textInputs.forEach(input => {
            if (testCase.title.includes('特殊文字')) {
                steps.push({
                    label: `${input.label || input.name}に特殊文字を入力`,
                    action: 'fill',
                    target: input.selector,
                    value: '!@#$%^&*()_+{}[]|\\:";\'<>?,./'
                });
            }
            
            if (testCase.title.includes('最大文字数')) {
                steps.push({
                    label: `${input.label || input.name}に最大文字数を入力`,
                    action: 'fill',
                    target: input.selector,
                    value: 'a'.repeat(255) // 一般的な最大文字数
                });
            }
        });

        // 送信ボタンクリック
        const submitButton = domStructure.buttons.find(btn => 
            btn.text && (btn.text.includes('確認') || btn.text.includes('送信'))
        );

        if (submitButton) {
            steps.push({
                label: '入力後に送信ボタンをクリック',
                action: 'click',
                target: submitButton.selector
            });
        }

        return {
            scenario_id: `scenario_input_validation_${Date.now()}`,
            route_id: `input_validation_${Date.now()}`, // 🔄 後方互換性のために保持
            test_case_id: testCase.id,
            category: 'input_validation',
            title: testCase.title,
            steps: steps,
            generated_at: new Date().toISOString(),
            automation_approach: 'input_boundary_testing'
        };
    }

    /**
     * メインの解析実行
     */
    async analyzeAndGenerateRoutes(targetUrl = null) {
        try {
            console.log('🔧 未自動化ケース分析・ルート生成開始\n');
            
            await this.initialize();
            
            const url = targetUrl || this.config.target_url;
            if (!url) {
                throw new Error('対象URLが設定されていません');
            }

            // 1. 未自動化テストケースの取得
            const unautomatedCases = this.getLatestUnautomatedCases();
            if (unautomatedCases.length === 0) {
                console.log('✅ 未自動化テストケースはありません');
                return;
            }

            // 2. DOM構造解析
            const domStructure = await this.analyzePageStructure(url);
            if (!domStructure) {
                throw new Error('DOM構造解析に失敗しました');
            }

            // 3. テストケースの分類
            const categorized = this.categorizeUnautomatedCases(unautomatedCases, domStructure);

            // 4. カテゴリ別ルート生成
            const generatedRoutes = [];

            // 表示確認ルート生成
            for (const testCase of categorized.displayValidation) {
                const route = this.generateDisplayValidationRoute(testCase, domStructure);
                generatedRoutes.push(route);
                console.log(`✅ 表示確認ルート生成: ${testCase.id}`);
            }

            // エラー処理ルート生成
            for (const testCase of categorized.errorHandling) {
                const route = this.generateErrorHandlingRoute(testCase, domStructure);
                generatedRoutes.push(route);
                console.log(`✅ エラー処理ルート生成: ${testCase.id}`);
            }

            // 入力検証ルート生成
            for (const testCase of categorized.inputValidation) {
                const route = this.generateInputValidationRoute(testCase, domStructure);
                generatedRoutes.push(route);
                console.log(`✅ 入力検証ルート生成: ${testCase.id}`);
            }

            // 5. 生成されたルートの保存
            for (const route of generatedRoutes) {
                const filename = `route_${route.route_id}.json`;
                const filepath = path.join(this.testResultsDir, filename);
                fs.writeFileSync(filepath, JSON.stringify(route, null, 2));
                console.log(`💾 ルート保存: ${filename}`);
            }

            console.log(`\n🎉 未自動化ケース分析完了！`);
            console.log(`📊 生成されたルート数: ${generatedRoutes.length}件`);
            console.log(`💡 次のステップ: runScenarios.jsで新しいシナリオを実行してください`);

            return generatedRoutes;

        } catch (error) {
            console.error('❌ 未自動化ケース分析エラー:', error.message);
            throw error;
        } finally {
            await this.cleanup();
        }
    }
}

// CLI実行時の処理
if (import.meta.url === `file://${process.argv[1]}`) {
    const analyzer = new UnautomatedCaseAnalyzer();
    
    // CLIオプション解析
    const args = process.argv.slice(2);
    const urlIndex = args.indexOf('--url');
    const targetUrl = urlIndex !== -1 ? args[urlIndex + 1] : null;

    analyzer.analyzeAndGenerateRoutes(targetUrl)
        .then(() => {
            console.log('✅ 未自動化ケース分析が正常終了しました');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ 未自動化ケース分析が失敗しました:', error.message);
            process.exit(1);
        });
}

export { UnautomatedCaseAnalyzer }; 