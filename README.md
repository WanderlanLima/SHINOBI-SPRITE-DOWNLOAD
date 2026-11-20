# Shinobi Vault — Banco de Dados e Exportador Naruto JotaGame

Aplicação **100% estática** compatível com **GitHub Pages** e **download completo direto no celular** para explorar, visualizar animações Spine 3.8 / 2D, ouvir dublagens e baixar todo o conteúdo de `naruto.jotagame.com` organizado em arquivos `.zip`.

## Como publicar no GitHub Pages

1. Crie um repositório no GitHub e envie todos os arquivos deste projeto (`git push`).
2. No repositório do GitHub, abra **Settings → Pages**.
3. Em **Build and deployment → Source**, selecione **GitHub Actions**.
4. O workflow `.github/workflows/deploy-pages.yml` será executado automaticamente:
   - Atualiza `public/data/studio-snapshot.json` direto de `naruto.jotagame.com`.
   - Compila o site estático com Vite (`dist/`).
   - Publica automaticamente no endereço `https://<seu-usuario>.github.io/<seu-repositorio>/`.
5. Você também pode reatualizar o catálogo quando o jogo lançar novos ninjas clicando em **Actions → Deploy Shinobi Vault para GitHub Pages → Run workflow**.

### A página ficou toda branca no GitHub Pages?

Se a página abrir branca, quase sempre significa que o GitHub Pages ainda está configurado em **Deploy from a branch** (`main` / `root`) em vez de **GitHub Actions** (o GitHub Pages não compila arquivos `.tsx` diretamente da branch):

1. Confirme que a pasta `.github/workflows/deploy-pages.yml` está presente no repositório no GitHub (ao subir arquivos arrastando pelo navegador, pastas ocultas iniciadas com ponto `.` podem ser ignoradas — prefira `git push` ou crie o arquivo `.github/workflows/deploy-pages.yml` direto no GitHub).
2. Vá em **Settings → Pages → Build and deployment → Source** e selecione **GitHub Actions** (não deixe *Deploy from a branch*).
3. Abra a aba **Actions**, clique em **Deploy Shinobi Vault para GitHub Pages** e depois em **Run workflow**.
4. Aguarde os dois passos (`build` e `deploy`) ficarem verdes e abra o link exibido na etapa `deploy`.

## Como fazer o download completo direto no celular

1. Abra o link do seu GitHub Pages no navegador do celular (Chrome no Android ou Safari no iOS).
2. Toque na aba **Exportador ZIP → Download Completo no Celular**.
3. O acervo completo (`80.000+` arquivos) é dividido automaticamente em **partes seguras (~80–120 MB cada)** para não travar a memória RAM do celular.
4. Você pode baixar **parte por parte** ou usar **Baixar Categoria em Sequência**. O progresso fica salvo automaticamente no aparelho.
5. Ao descompactar as partes na mesma pasta (ex.: usando ZArchiver no Android ou o app Arquivos no iOS), todos os arquivos se unem automaticamente nesta estrutura:

```text
naruto_jotagame_acervo/
├── 00_banco_de_dados/      (database_completo.json, CSVs de ninjas/técnicas, índices)
├── 01_ninjas/              (pastas por ninja: ficha, retratos, banners PT, Spine HD/batalha, áudios)
├── 02_invocacoes/          (50 invocações Spine 3.8 + fragmentos)
├── 03_animacoes_sprites/   (modelos Spine organizados por tipo)
├── 04_habilidades_efeitos/ (efeitos Spine, spritesheets 2D, vídeos MP4, ícones de habilidades)
└── 05_sons_e_dublagens/    (dublagens de falas, esotéricas, derrota, história e combate)
```

## Desenvolvimento local

```bash
npm install
npm run sync   # Atualiza public/data/studio-snapshot.json
npm run dev    # Abre em http://localhost:3000
npm run build  # Gera o site estático em dist/
```
