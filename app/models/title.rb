class Title < ApplicationRecord
  has_and_belongs_to_many :functions, inverse_of: :titles
  has_many :compositions, inverse_of: :title
  has_many :inclusions, through: :compositions

  validates :text, presence: true, uniqueness: true
end
