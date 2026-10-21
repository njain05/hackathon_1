"""A realistic sample engineering college, used for demos and tests."""

from .models import (
    Assignment,
    CollegeData,
    Department,
    Room,
    RoomType,
    Section,
    Settings,
    Subject,
    Teacher,
)

# (id, code, name, dept, lecture hours, lab hours, lab rooms or None)
_SUBJECTS = [
    # CSE, 3rd semester
    ("cs-ds", "CS201", "Data Structures", "cse", 3, 2, ["cl-1", "cl-2"]),
    ("cs-dm", "MA201", "Discrete Mathematics", "cse", 4, 0, None),
    ("cs-dbms", "CS203", "Database Management Systems", "cse", 3, 2, ["cl-1", "cl-2"]),
    ("cs-de", "CS205", "Digital Electronics", "cse", 3, 0, None),
    ("cs-coa", "CS207", "Computer Organisation", "cse", 3, 0, None),
    ("cs-oop", "CS209", "Object Oriented Programming (Java)", "cse", 2, 2, ["cl-1", "cl-2"]),
    # CSE, 5th semester
    ("cs-os", "CS301", "Operating Systems", "cse", 3, 2, ["cl-1", "cl-2"]),
    ("cs-cn", "CS303", "Computer Networks", "cse", 3, 2, ["cl-1", "cl-2"]),
    ("cs-daa", "CS305", "Design and Analysis of Algorithms", "cse", 4, 0, None),
    ("cs-se", "CS307", "Software Engineering", "cse", 3, 0, None),
    ("cs-ml", "CS309", "Machine Learning", "cse", 3, 2, ["cl-1", "cl-2"]),
    # ECE, 3rd semester
    ("ec-ss", "EC201", "Signals and Systems", "ece", 4, 0, None),
    ("ec-ae", "EC203", "Analog Electronics", "ece", 3, 2, ["el-1"]),
    ("ec-na", "EC205", "Network Analysis", "ece", 3, 0, None),
    ("ec-de", "EC207", "Digital Electronics", "ece", 3, 2, ["el-1"]),
    ("ec-m3", "MA203", "Engineering Mathematics III", "ece", 4, 0, None),
    ("ec-py", "EC209", "Python Programming", "ece", 2, 2, ["cl-1", "cl-2"]),
    # ECE, 5th semester
    ("ec-mp", "EC301", "Microprocessors", "ece", 3, 2, ["el-1"]),
    ("ec-cs", "EC303", "Communication Systems", "ece", 3, 2, ["el-1"]),
    ("ec-ctl", "EC305", "Control Systems", "ece", 4, 0, None),
    ("ec-vlsi", "EC307", "VLSI Design", "ece", 3, 0, None),
    ("ec-ant", "EC309", "Antennas and Wave Propagation", "ece", 3, 0, None),
]

_TEACHERS = [
    ("t-harpreet", "Dr. Harpreet Kaur", "cse"),
    ("t-amandeep", "Prof. Amandeep Singh", "cse"),
    ("t-neha", "Dr. Neha Sharma", "cse"),
    ("t-rajesh", "Prof. Rajesh Kumar", "cse"),
    ("t-simranjeet", "Dr. Simranjeet Kaur", "cse"),
    ("t-gurpreet", "Prof. Gurpreet Singh", "cse"),
    ("t-anjali", "Dr. Anjali Verma", "cse"),
    ("t-manpreet", "Prof. Manpreet Gill", "cse"),
    ("t-parminder", "Dr. Parminder Sandhu", "cse"),
    ("t-baljit", "Dr. Baljit Singh", "ece"),
    ("t-ritu", "Prof. Ritu Bansal", "ece"),
    ("t-sukhwinder", "Dr. Sukhwinder Singh", "ece"),
    ("t-kavita", "Prof. Kavita Arora", "ece"),
    ("t-vikram", "Dr. Vikram Malhotra", "ece"),
]

# section -> [(subject, teacher)]
_ASSIGNMENTS = {
    "cse-3a": [
        ("cs-ds", "t-harpreet"), ("cs-dm", "t-parminder"), ("cs-dbms", "t-amandeep"),
        ("cs-de", "t-rajesh"), ("cs-coa", "t-simranjeet"), ("cs-oop", "t-gurpreet"),
    ],
    "cse-3b": [
        ("cs-ds", "t-harpreet"), ("cs-dm", "t-parminder"), ("cs-dbms", "t-neha"),
        ("cs-de", "t-rajesh"), ("cs-coa", "t-simranjeet"), ("cs-oop", "t-gurpreet"),
    ],
    "cse-5a": [
        ("cs-os", "t-anjali"), ("cs-cn", "t-manpreet"), ("cs-daa", "t-harpreet"),
        ("cs-se", "t-rajesh"), ("cs-ml", "t-neha"),
    ],
    "ece-3a": [
        ("ec-ss", "t-baljit"), ("ec-ae", "t-ritu"), ("ec-na", "t-sukhwinder"),
        ("ec-de", "t-kavita"), ("ec-m3", "t-parminder"), ("ec-py", "t-amandeep"),
    ],
    "ece-5a": [
        ("ec-mp", "t-vikram"), ("ec-cs", "t-baljit"), ("ec-ctl", "t-sukhwinder"),
        ("ec-vlsi", "t-kavita"), ("ec-ant", "t-ritu"),
    ],
}


def sample_college() -> CollegeData:
    return CollegeData(
        name="Sample Institute of Engineering & Technology",
        settings=Settings(
            days=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
            periods_per_day=7,
            lunch_after_period=4,
            period_times=[
                "09:00-09:50", "09:50-10:40", "10:40-11:30", "11:30-12:20",
                "13:00-13:50", "13:50-14:40", "14:40-15:30",
            ],
        ),
        departments=[
            Department(id="cse", name="Computer Science & Engineering"),
            Department(id="ece", name="Electronics & Communication Engineering"),
        ],
        sections=[
            Section(id="cse-3a", name="CSE 3rd Sem A", department_id="cse", strength=60),
            Section(id="cse-3b", name="CSE 3rd Sem B", department_id="cse", strength=58),
            Section(id="cse-5a", name="CSE 5th Sem A", department_id="cse", strength=55),
            Section(id="ece-3a", name="ECE 3rd Sem A", department_id="ece", strength=60),
            Section(id="ece-5a", name="ECE 5th Sem A", department_id="ece", strength=48),
        ],
        subjects=[
            Subject(
                id=i, code=c, name=n, department_id=d,
                lecture_hours=lec, lab_hours=lab, lab_room_ids=rooms,
            )
            for i, c, n, d, lec, lab, rooms in _SUBJECTS
        ],
        teachers=[Teacher(id=i, name=n, department_id=d) for i, n, d in _TEACHERS],
        assignments=[
            Assignment(section_id=sec, subject_id=sub, teacher_id=t)
            for sec, pairs in _ASSIGNMENTS.items()
            for sub, t in pairs
        ],
        rooms=[
            Room(id="c-101", name="Room C-101", type=RoomType.CLASSROOM, capacity=65, department_id="cse"),
            Room(id="c-102", name="Room C-102", type=RoomType.CLASSROOM, capacity=65, department_id="cse"),
            Room(id="c-103", name="Room C-103", type=RoomType.CLASSROOM, capacity=60, department_id="cse"),
            Room(id="e-201", name="Room E-201", type=RoomType.CLASSROOM, capacity=65, department_id="ece"),
            Room(id="e-202", name="Room E-202", type=RoomType.CLASSROOM, capacity=50, department_id="ece"),
            Room(id="lt-1", name="Lecture Theatre 1", type=RoomType.CLASSROOM, capacity=120),
            Room(id="cl-1", name="Computer Lab 1", type=RoomType.LAB, capacity=60),
            Room(id="cl-2", name="Computer Lab 2", type=RoomType.LAB, capacity=60),
            Room(id="el-1", name="Electronics Lab", type=RoomType.LAB, capacity=60, department_id="ece"),
            Room(id="sh-1", name="Seminar Hall", type=RoomType.SEMINAR_HALL, capacity=150),
            Room(id="aud-1", name="Main Auditorium", type=RoomType.AUDITORIUM, capacity=600),
        ],
    )
