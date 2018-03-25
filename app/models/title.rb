class Title < ApplicationRecord
  has_and_belongs_to_many :functions, inverse_of: :titles
  has_many :compositions
  has_many :inclusions, through: :compositions
end
