FactoryGirl.define do
  factory :piece do
    sequence(:title) { |n| "Piece #{n}" }
  end
end
