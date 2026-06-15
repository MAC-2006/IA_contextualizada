import os

# Configurações
ROOT_DIR = "."
OUTPUT_FILE = "contexto_projeto.txt"
# Pastas que não queremos ler (muito pesadas ou irrelevantes)
IGNORE_DIRS = {
    'venv', 'node_modules', '.git', '__pycache__', 
    'docker-volumes', 'dist', '.vite', 'ollama_models'
}
# Extensões que queremos capturar
INCLUDE_EXTENSIONS = {
    '.py', '.tsx', '.ts', '.css', '.html', 
    '.yml', '.yaml', '.json', '.txt'
}

def gerar_contexto():
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f_out:
        for root, dirs, files in os.walk(ROOT_DIR):
            # Filtra pastas ignoradas
            dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
            
            for file in files:
                ext = os.path.splitext(file)[1]
                if ext in INCLUDE_EXTENSIONS and file != OUTPUT_FILE:
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, ROOT_DIR)
                    
                    f_out.write(f"\n{'='*50}\n")
                    f_out.write(f"ARQUIVO: {rel_path}\n")
                    f_out.write(f"{'='*50}\n\n")
                    
                    try:
                        with open(full_path, "r", encoding="utf-8") as f_in:
                            f_out.write(f_in.read())
                    except Exception as e:
                        f_out.write(f"Erro ao ler arquivo: {e}")
                    f_out.write("\n")

    print(f"✅ Contexto gerado com sucesso em: {OUTPUT_FILE}")

if __name__ == "__main__":
    gerar_contexto()