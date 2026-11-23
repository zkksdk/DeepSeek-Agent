import os
import re
from deep_translator import GoogleTranslator

def translate_markdown(text):
    # 匹配 Markdown 代码块 (```...```) 和行内代码 (`...`)
    # 使用捕获组保留它们，不进行翻译
    pattern = r'(```.*?```|`[^`\n]+`)'
    
    # 将文本按代码块/行内代码分割成列表
    # 例如: ['普通文本1', '```code```', '普通文本2']
    parts = re.split(pattern, text, flags=re.DOTALL)
    
    translator = GoogleTranslator(source='zh-CN', target='en')
    translated_parts = []
    
    for part in parts:
        if not part.strip():
            translated_parts.append(part)
            continue
            
        # 如果是代码块或行内代码，直接保留
        if part.startswith('```') or part.startswith('`'):
            translated_parts.append(part)
            continue
            
        # 如果是普通文本，进行翻译
        try:
            # Google Translate 有长度限制（通常约 5000 字符），这里按段落翻译防止超限
            paragraphs = part.split('\n')
            translated_paragraphs = []
            for p in paragraphs:
                if p.strip():
                    # deep-translator 有时对空行处理不好，加个 strip
                    translated_p = translator.translate(p)
                    translated_paragraphs.append(translated_p)
                else:
                    translated_paragraphs.append(p)
            translated_parts.append('\n'.join(translated_paragraphs))
        except Exception as e:
            print(f"翻译段落出错: {e}，保留原文。")
            translated_parts.append(part)
            
    return ''.join(translated_parts)

def main():
    input_file = "README.md"
    output_file = "docs/README.en.md"

    if not os.path.exists(input_file):
        print(f"未找到 {input_file}")
        return

    os.makedirs(os.path.dirname(output_file), exist_ok=True)

    print(f"正在读取 {input_file}...")
    with open(input_file, "r", encoding="utf-8") as f:
        content = f.read()

    print("正在翻译（这可能需要几分钟）...")
    translated_content = translate_markdown(content)

    # 加上双语头部提示
    header = "> This file is automatically translated by machine. Please refer to the [Chinese README](../README.md) for accuracy.\n\n"
    
    with open(output_file, "w", encoding="utf-8") as f:
        f.write(header + translated_content)
        
    print(f"翻译完成，已保存至 {output_file}")

if __name__ == "__main__":
    main()