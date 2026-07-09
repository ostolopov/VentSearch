import pytest
from infrastructure.search.bloom_filter import BloomFilter

def test_bloom_add_and_check():
    """Проверка: добавленный вентилятор должен находиться фильтром"""
    bf = BloomFilter(expected_items=100)
    model = "Вентилятор ВР 80-75"
    
    bf.add(model)
    
    # Метод might_contain должен подтвердить наличие
    assert bf.might_contain(model) is True

def test_bloom_not_found():
    """Проверка: если ничего не добавляли, фильтр должен говорить 'нет'"""
    bf = BloomFilter(expected_items=100)
    
    # Проверяем модель, которую точно не вносили
    assert bf.might_contain("Несуществующая модель") is False

def test_bloom_add_many():
    """Проверка: добавление целого списка моделей за раз"""
    bf = BloomFilter(expected_items=50)
    data = ["VO-11", "VTS-20", "VR-55"]
    
    bf.add_many(data)
    
    for item in data:
        assert bf.might_contain(item) is True

def test_bloom_empty_input():
    """Проверка: корректная работа с пустой строкой"""
    bf = BloomFilter()
    bf.add("")
    assert bf.might_contain("") is True


def test_bloom_stats_shape_and_fill():
    """stats() отдаёт битовую карту для визуализации в админке."""
    bf = BloomFilter(expected_items=10)
    stats = bf.stats()
    assert stats["bits_set"] == 0
    assert stats["fill_ratio"] == 0.0
    assert len(stats["bits"]) == stats["m"]
    assert all(b == 0 for b in stats["bits"])

    bf.add("ВО")
    bf.add("ВЦ")
    stats2 = bf.stats()
    assert stats2["bits_set"] > 0
    assert stats2["bits_set"] <= stats2["m"]
    assert 0 < stats2["fill_ratio"] <= 1.0
    assert sum(stats2["bits"]) == stats2["bits_set"]