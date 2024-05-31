class ClefCombination < ApplicationRecord
  has_many :inclusions
  has_and_belongs_to_many :voicings
end
