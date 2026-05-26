import csv
import json
import random
from pathlib import Path

TYPES = ["ВО", "ВЦ", "ВКОП", "УВО", "ВР", "Ц"]

def generate():
    out_path = Path("data/ventsearch_massive_sorted.csv")
    
    # Резервная копия на случай, если старые данные пригодятся
    backup_path = Path("data/ventsearch_massive_sorted_backup.csv")
    if out_path.exists() and not backup_path.exists():
        out_path.rename(backup_path)
        
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.writer(f, delimiter=";")
        writer.writerow([
            "Номер", "Тип", "Модель", "Типоразмер", "Диаметр ММ", 
            "Производительность м3/ч", "Давление(па)", "Мощность(ВТ)", 
            "Уровень шума", "Цена в рублях", 
            "nominal_rpm", "pressure_coefficients", "efficiency_coefficients"
        ])
        
        for i in range(1, 5001):
            t = random.choice(TYPES)
            size_n = random.randint(20, 120)
            model = f"{t} {size_n}-{random.randint(100, 200)}-{i}"
            size = f"{t} {size_n}"
            diameter = size_n * 10
            
            q_min = random.randint(500, 2000)
            q_max = q_min + random.randint(1000, 10000)
            p_max = random.randint(300, 1500)
            p_min = random.randint(50, p_max - 50)
            
            power = random.randint(100, 5000)
            noise = random.randint(60, 110)
            price = random.randint(10000, 200000)
            
            # Для ~50% вентиляторов задаем коэффициенты, остальные 50% будут работать по Безье (fallback)
            if random.random() > 0.5:
                nominal_rpm = random.choice([1000, 1450, 2900])
                
                # Простая парабола давления: P(Q) = P_max - ((P_max - P_min) / Q_max^2) * Q^2
                k = (p_max - p_min) / (q_max ** 2)
                
                # Для осевых сделаем небольшой горб (добавим линейный член)
                if t in ["ВО", "ВКОП", "УВО"]:
                    # P(Q) = a0 + a1*Q + a2*Q^2
                    # Пусть P(0) = p_max - 50
                    # В точке q_max, P = p_min
                    a0 = p_max - 50
                    a1 = 0.02
                    a2 = (p_min - a0 - a1 * q_max) / (q_max ** 2)
                    p_coeffs = [a0, a1, a2]
                else:
                    p_coeffs = [p_max, 0, -k]
                
                # КПД: парабола ветвями вниз
                e_coeffs = [0, 0.0002, -0.00000001]
                
                rpm_str = str(nominal_rpm)
                p_str = json.dumps(p_coeffs)
                e_str = json.dumps(e_coeffs)
            else:
                rpm_str = ""
                p_str = ""
                e_str = ""
                
            writer.writerow([
                i, t, model, size, diameter,
                f"{q_min} - {q_max}", f"{p_min} - {p_max}", power, noise, price,
                rpm_str, p_str, e_str
            ])
            
    print(f"Сгенерировано 5000 вентиляторов в {out_path}")

if __name__ == "__main__":
    generate()
