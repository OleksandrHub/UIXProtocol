# -*- coding: utf-8 -*-

import threading
import os
import time
import re
import glob
import google.generativeai as genai
from google.generativeai.types import HarmCategory, HarmBlockThreshold
import pyautogui
from pynput import mouse, keyboard
from PIL import Image, ImageDraw, ImageFont
import pystray

# === ⚙️ КОНФІГУРАЦІЯ API ===
API_KEY = "AIzaSyAKUGMq3l1GUxFK5E_ypUZKNsPPKLZGfno" #AIzaSyArSKTYuwWD5sgK-3vTfsQe7Y0sYC25tKY
GEMINI_FLASH_NAME = "gemini-2.5-flash"
GEMINI_PRO_NAME = "gemini-2.5-pro"
SCREENSHOT_DIR = "screenshots"
# ===============================================

SCROLL_RATE_LIMIT = 5.0 # Секунд між спрацюваннями (збільшено до 5 сек для надійності)
last_action_time = 0

# === КОНФІГУРАЦІЯ TRAY ===
DIGIT_DISPLAY_DELAY = 2.0  # Змінено на 2.0 секунди, як ви просили
LAST_TOOLTIP = "Очікування першого запиту..."
# === ГЛОБАЛЬНА ЗМІННА ДЛЯ БАЗИ ЗНАНЬ ===
KNOWLEDGE_BASE = []

# Налаштування бібліотеки та ініціалізація
genai.configure(api_key=API_KEY)
model_flash = genai.GenerativeModel(GEMINI_FLASH_NAME)
model_pro = genai.GenerativeModel(GEMINI_PRO_NAME)

# Налаштування безпеки
safety_settings = {
    HarmCategory.HARM_CATEGORY_HARASSMENT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}

PROMPT_TEXT = """
Твоя задача — діяти як дуже точний, уважний асистент для проходження тестів.
Використовуй надані PDF-файли як основне джерело знань.

ВАЖЛИВО:
1. Шукай відповіді в PDF за змістом. Якщо точної відповіді немає, виведи логічно.
2. СУВОРО: НІКОЛИ не змінюй і не перекладай букви варіантів! Якщо в тесті латиниця (A, B, C, D, E) — у відповіді пиши латиницю. Якщо кирилиця (А, Б, В) — пиши кирилицю.
3. Якщо один зі стовпчиків у завданні на відповідність не має нумерації чи букв (просто слова), подумки пронумеруй його елементи зверху вниз як 1, 2, 3... і використовуй ці цифри.

ФОРМАТ ВІДПОВІДІ:
- Для звичайних тестів повертай номери: [2] або [1, 4].
- Для тестів на ВІДПОВІДНІСТЬ повертай пари РАЗОМ, без пробілів. Наприклад: латиницею [1C, 2A, 3E] або кирилицею [1Б, 2А, 3Г].
Не додавай жодних слів. ТІЛЬКИ послідовність у квадратних дужках.
"""

def ensure_directory(path):
    if not os.path.exists(path):
        os.makedirs(path)
        print(f"📁 Створено папку: {path}")
    else:
        print(f"📁 Папка {path} вже існує.")

# --- Функція завантаження PDF ---
def upload_all_pdfs(folder_name="pdf"):
    loaded_files = []

    if not os.path.exists(folder_name):
        print(f"⚠️ Папка '{folder_name}' не знайдена! Працюємо без PDF.")
        return []

    pdf_paths = glob.glob(os.path.join(folder_name, "*.pdf"))

    if not pdf_paths:
        print(f"⚠️ У папці '{folder_name}' немає PDF файлів.")
        return []

    print(f"📂 Знайдено PDF файлів: {len(pdf_paths)}. Починаю завантаження...")

    for path in pdf_paths:
        try:
            print(f"   📤 Завантаження: {path}...")
            file_obj = genai.upload_file(path)

            while file_obj.state.name == "PROCESSING":
                time.sleep(1)
                file_obj = genai.get_file(file_obj.name)

            if file_obj.state.name == "FAILED":
                print(f"   ❌ Помилка обробки файлу: {path}")
            else:
                loaded_files.append(file_obj)
                print(f"   ✅ Готово.")

        except Exception as e:
            print(f"   ❌ Помилка при завантаженні {path}: {e}")

    print(f"🏁 Успішно завантажено {len(loaded_files)} файлів до бази знань.\n")
    return loaded_files

# --- Функції для системного трея (Tray) ---

TRAY_ICON = None


def create_status_image(status_text: str):
    size = (32, 32)
    img = Image.new('RGB', size, color=(30, 30, 30))
    d = ImageDraw.Draw(img)

    # Якщо символів більше 1 (наприклад "А1"), робимо шрифт меншим
    font_size = 20 if len(status_text) <= 1 else 16

    try:
        font = ImageFont.truetype("arial.ttf", font_size)
    except IOError:
        font = ImageFont.load_default()

    if status_text in ('E', 'T', 'помилка'):
        color = "red"
    elif status_text == 'L':
        color = "yellow"
    else:
        color = "white"

    try:
        bbox = d.textbbox((0, 0), status_text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except AttributeError:
        text_w, text_h = d.textsize(status_text, font=font)

    x = (size[0] - text_w) / 2
    y = (size[1] - text_h) / 2
    d.text((x, y), status_text, fill=color, font=font)
    return img

def update_tray_status(status: str, tooltip: str = "Gemini Асистент"):
    global TRAY_ICON
    if TRAY_ICON:
        TRAY_ICON.icon = create_status_image(status)
        TRAY_ICON.title = tooltip

def setup_tray_icon():
    global TRAY_ICON
    initial_image = create_status_image('L')

    def on_exit(icon, item):
        icon.stop()
        os._exit(0)

    menu = (
        pystray.MenuItem(f'К: {SCROLL_RATE_LIMIT}', lambda icon, item: None),
        pystray.MenuItem('Вихід', on_exit)
    )
    
    TRAY_ICON = pystray.Icon("Gemini_Assistant", initial_image, "Завантаження файлів...", menu)
    threading.Thread(target=TRAY_ICON.run, daemon=True).start()
    return TRAY_ICON

# --- Фонове завантаження ---
def background_loader():
    global KNOWLEDGE_BASE
    update_tray_status('L', "Завантаження PDF на сервер...")

    KNOWLEDGE_BASE = upload_all_pdfs("pdf")

    count = len(KNOWLEDGE_BASE)
    update_tray_status('W', f"Готовий! Завантажено PDF: {count}")

# === Скриншот ===
def take_screenshot():
    img = pyautogui.screenshot()
    max_width = 1920
    if img.width > max_width:
        scale = max_width / img.width
        new_height = int(img.height * scale)
        try:
            img = img.resize((max_width, new_height), Image.Resampling.LANCZOS)
        except AttributeError:
            img = img.resize((max_width, new_height), Image.ANTIALIAS)

    timestamp = time.strftime("%Y%m%d_%H%M%S")
    filename = os.path.join(SCREENSHOT_DIR, f"screenshot_{timestamp}.jpg")

    img.save(filename, format="JPEG", quality=85)

    return img


# === Відправка ===
def send_to_gemini(model_instance, image_obj):
    try:
        content = [PROMPT_TEXT, image_obj] + KNOWLEDGE_BASE
        response = model_instance.generate_content(content, safety_settings=safety_settings)

        # Просто повертаємо чистий текст відповіді (наприклад "[А1, 1Б, ВГ]")
        return response.text.strip()

    except Exception as e:
        print(f"\n❌ ПОМИЛКА GEMINI: {e}\n")
        return "помилка"

# === Функція обробки прокрутки ролика ===
def on_scroll(x, y, dx, dy):
    global last_action_time

    current_time = time.time()

    if current_time - last_action_time > SCROLL_RATE_LIMIT:

        if dy > 0:
            model_to_use = model_flash
            name_to_display = GEMINI_FLASH_NAME
        elif dy < 0:
            model_to_use = model_pro
            name_to_display = GEMINI_PRO_NAME
        else:
            return

        last_action_time = current_time

        threading.Thread(target=on_hotkey, args=(model_to_use, name_to_display), daemon=True).start()

def on_press(key):
    global last_action_time
    try:
        if key == keyboard.Key.up:
            model_to_use, name_to_display = model_flash, GEMINI_FLASH_NAME
        elif key == keyboard.Key.down:
            model_to_use, name_to_display = model_pro, GEMINI_PRO_NAME
        else:
            return

        current_time = time.time()
        if current_time - last_action_time > SCROLL_RATE_LIMIT:
            last_action_time = current_time
            threading.Thread(target=on_hotkey, args=(model_to_use, name_to_display), daemon=True).start()
    except Exception:
        pass

def on_hotkey(model_instance, model_name):
    global LAST_TOOLTIP # Використовуємо глобальну змінну для пам'яті
    update_tray_status('P', f"Обробка ({model_name})...")

    try:
        image_obj = take_screenshot()
        answer = send_to_gemini(model_instance, image_obj)

        if answer not in ["немає відповіді", "таймаут", "помилка"]:
            # Шукаємо всі логічні пари або одиночні відповіді (1-2 символи)
            # З рядка "[1Б, АВ, 4]" воно зробить список ['1Б', 'АВ', '4']
            matches = re.findall(r'[А-ЯІЇЄҐA-Z0-9]{1,2}', answer.upper())

            if matches:
                # Формуємо рядок і записуємо в глобальну пам'ять
                full_answer_str = " | ".join(matches)
                LAST_TOOLTIP = f"Відповідь: {full_answer_str}"

                TRAY_ICON.title = LAST_TOOLTIP

                # По черзі блимаємо результатами
                for item in matches:
                    update_tray_status(item, LAST_TOOLTIP)
                    time.sleep(DIGIT_DISPLAY_DELAY)

            else:
                update_tray_status('E', "Не знайдено відповідей")
                time.sleep(2)
        else:
            update_tray_status('E', f"Помилка: {answer}")
            time.sleep(2)

    except Exception:
        update_tray_status('E', "Критична помилка")
        time.sleep(2)

    finally:
        # Повертаємо іконку в W, але підказка залишається з ОСТАННЬОЮ відповіддю!
        update_tray_status('W', LAST_TOOLTIP)

# === MAIN ===
# === MAIN ===
if __name__ == '__main__':
    ensure_directory(SCREENSHOT_DIR)
    setup_tray_icon()
    time.sleep(0.5)
    threading.Thread(target=background_loader, daemon=True).start()
    
    # Створюємо обидва слухачі
    mouse_listener = mouse.Listener(on_scroll=on_scroll)
    key_listener = keyboard.Listener(on_press=on_press)

    # Запускаємо їх
    mouse_listener.start()
    key_listener.start()

    try:
        # Тримаємо головний потік активним, поки працюють слухачі
        mouse_listener.join()
        key_listener.join()
    except KeyboardInterrupt:
        mouse_listener.stop()
        key_listener.stop()