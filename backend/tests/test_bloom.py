import pytest
from search.bloom_filter import BloomFilter 

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