class Group < ApplicationRecord
  has_many :compositions
  has_many :editions
  has_many :recordings
end
